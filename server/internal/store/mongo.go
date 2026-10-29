package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Mongo stores everything in four collections: players, profiles, linkcodes, raids.
type Mongo struct {
	client   *mongo.Client
	players  *mongo.Collection
	profiles *mongo.Collection
	codes    *mongo.Collection
	raids    *mongo.Collection
}

// profileDoc keeps the save as a JSON string: the engine's schema has keys Mongo dislikes
// (dotted ids, numeric map keys) and the server never queries inside it.
type profileDoc struct {
	ID        string    `bson:"_id"`
	Rev       int64     `bson:"rev"`
	JSON      string    `bson:"json"`
	UpdatedAt time.Time `bson:"updatedAt"`
}

type codeDoc struct {
	Code     string    `bson:"_id"`
	PlayerID string    `bson:"playerId"`
	Expires  time.Time `bson:"expires"`
}

func NewMongo(ctx context.Context, uri, db string) (*Mongo, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri).SetServerSelectionTimeout(10 * time.Second))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(ctx)
		return nil, fmt.Errorf("ping: %w", err)
	}
	d := client.Database(db)
	m := &Mongo{client: client, players: d.Collection("players"), profiles: d.Collection("profiles"), codes: d.Collection("linkcodes"), raids: d.Collection("raids")}
	if err := m.ensureIndexes(ctx); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}
	return m, nil
}

func (m *Mongo) ensureIndexes(ctx context.Context) error {
	if _, err := m.players.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "tokenHashes", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "xp", Value: -1}}},
	}); err != nil {
		return fmt.Errorf("players indexes: %w", err)
	}
	// Expired link codes are swept by Mongo's TTL monitor.
	if _, err := m.codes.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "expires", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)}); err != nil {
		return fmt.Errorf("linkcodes index: %w", err)
	}
	if _, err := m.raids.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "playerId", Value: 1}, {Key: "at", Value: -1}}}); err != nil {
		return fmt.Errorf("raids index: %w", err)
	}
	return nil
}

func (m *Mongo) Kind() string                    { return "mongo" }
func (m *Mongo) Ping(ctx context.Context) error  { return m.client.Ping(ctx, nil) }
func (m *Mongo) Close(ctx context.Context) error { return m.client.Disconnect(ctx) }

func (m *Mongo) CreatePlayer(ctx context.Context, p Player) error {
	_, err := m.players.InsertOne(ctx, p)
	return err
}

func (m *Mongo) PlayerByTokenHash(ctx context.Context, hash string) (Player, error) {
	var p Player
	err := m.players.FindOne(ctx, bson.D{{Key: "tokenHashes", Value: hash}}).Decode(&p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return p, ErrNotFound
	}
	return p, err
}

func (m *Mongo) AddTokenHash(ctx context.Context, playerID, hash string) error {
	push := bson.D{{Key: "$push", Value: bson.D{{Key: "tokenHashes", Value: bson.D{{Key: "$each", Value: bson.A{hash}}, {Key: "$slice", Value: -MaxDevices}}}}}}
	res, err := m.players.UpdateByID(ctx, playerID, push)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) GetProfile(ctx context.Context, playerID string) (json.RawMessage, int64, error) {
	var d profileDoc
	err := m.profiles.FindOne(ctx, bson.D{{Key: "_id", Value: playerID}}).Decode(&d)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	return json.RawMessage(d.JSON), d.Rev, nil
}

func (m *Mongo) PutProfile(ctx context.Context, playerID string, data json.RawMessage, baseRev int64, st Stats) (int64, error) {
	next := baseRev + 1
	now := time.Now()
	set := bson.D{{Key: "$set", Value: bson.D{{Key: "rev", Value: next}, {Key: "json", Value: string(data)}, {Key: "updatedAt", Value: now}}}}
	if baseRev == 0 {
		// First save: insert, or conflict if another device got there first.
		_, err := m.profiles.InsertOne(ctx, profileDoc{ID: playerID, Rev: next, JSON: string(data), UpdatedAt: now})
		if mongo.IsDuplicateKeyError(err) {
			return 0, ErrConflict
		}
		if err != nil {
			return 0, err
		}
	} else {
		// Compare-and-swap on the revision.
		res, err := m.profiles.UpdateOne(ctx, bson.D{{Key: "_id", Value: playerID}, {Key: "rev", Value: baseRev}}, set)
		if err != nil {
			return 0, err
		}
		if res.MatchedCount == 0 {
			return 0, ErrConflict
		}
	}
	fields := bson.D{{Key: "xp", Value: st.XP}, {Key: "survived", Value: st.Survived}, {Key: "kills", Value: st.Kills}}
	if st.Name != "" {
		fields = append(fields, bson.E{Key: "name", Value: st.Name})
	}
	if _, err := m.players.UpdateByID(ctx, playerID, bson.D{{Key: "$set", Value: fields}}); err != nil {
		return 0, err
	}
	return next, nil
}

func (m *Mongo) SaveLinkCode(ctx context.Context, code, playerID string, expires time.Time) error {
	_, err := m.codes.InsertOne(ctx, codeDoc{Code: code, PlayerID: playerID, Expires: expires})
	return err
}

func (m *Mongo) TakeLinkCode(ctx context.Context, code string, now time.Time) (string, error) {
	var d codeDoc
	err := m.codes.FindOneAndDelete(ctx, bson.D{{Key: "_id", Value: code}}).Decode(&d)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	// The TTL sweep runs once a minute, so check expiry ourselves too.
	if now.After(d.Expires) {
		return "", ErrNotFound
	}
	return d.PlayerID, nil
}

func (m *Mongo) AddRaid(ctx context.Context, r Raid) error {
	_, err := m.raids.InsertOne(ctx, r)
	return err
}

func (m *Mongo) Leaderboard(ctx context.Context, limit int) ([]Player, error) {
	cur, err := m.players.Find(ctx, bson.D{{Key: "xp", Value: bson.D{{Key: "$gt", Value: 0}}}},
		options.Find().SetSort(bson.D{{Key: "xp", Value: -1}, {Key: "createdAt", Value: 1}}).SetLimit(int64(limit)).SetProjection(bson.D{{Key: "tokenHashes", Value: 0}}))
	if err != nil {
		return nil, err
	}
	var out []Player
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}
