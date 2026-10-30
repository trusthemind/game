// Package api is the HTTP surface the web client talks to (apps/web/src/state/api.ts).
//
//	GET  /api/v1/health            {ok, db}
//	POST /api/v1/players           {name}            → {playerId, token, code}
//	GET  /api/v1/profile           (auth)            → {profile, rev}
//	PUT  /api/v1/profile           (auth) {profile, baseRev} → {rev} | 409 {error, rev}
//	GET  /api/v1/players/me/code   (auth)            → {code}   one-time, 10 minutes
//	POST /api/v1/players/claim     {code}            → {playerId, token}
//	POST /api/v1/raids             (auth) {status, kills, xp, value, duration} → {ok}
//	GET  /api/v1/leaderboard                         → {entries: [{name, level, xp, survived, kills}]}
package api

import (
	"cmp"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/trusthemind/game/server/internal/cache"
	"github.com/trusthemind/game/server/internal/store"
)

const (
	maxProfileBytes = 4 << 20
	maxSmallBody    = 16 << 10
	linkCodeTTL     = 10 * time.Minute
	leaderboardSize = 50
)

type Server struct {
	store   store.Store
	log     *slog.Logger
	origins []string
	// Per-IP limits for the unauthenticated, guessable endpoints.
	register *limiter
	claim    *limiter
	now      func() time.Time
	// Token hash → player, so authenticated calls skip a database read. A token pushed out by a ninth
	// device stays usable for at most authTTL on instances that had it cached.
	auth  *cache.TTL[string, store.Player]
	board *cache.TTL[struct{}, []boardEntry]
}

const (
	authTTL  = time.Minute
	boardTTL = 5 * time.Second
)

type Options struct {
	// AllowedOrigins for CORS; empty or "*" allows any origin (tokens are bearer headers, not cookies).
	AllowedOrigins []string
	Logger         *slog.Logger
	// RegisterPerHour caps new accounts per client IP (default 10). Raise it for load tests.
	RegisterPerHour int
}

func New(s store.Store, o Options) *Server {
	log := o.Logger
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		store:    s,
		log:      log,
		origins:  o.AllowedOrigins,
		register: newLimiter(cmp.Or(o.RegisterPerHour, 10), time.Hour),
		claim:    newLimiter(20, 10*time.Minute),
		now:      time.Now,
		auth:     cache.New[string, store.Player](authTTL, 200_000),
		board:    cache.New[struct{}, []boardEntry](boardTTL, 1),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", s.health)
	mux.HandleFunc("POST /api/v1/players", s.createPlayer)
	mux.HandleFunc("GET /api/v1/profile", s.authed(s.getProfile))
	mux.HandleFunc("PUT /api/v1/profile", s.authed(s.putProfile))
	mux.HandleFunc("GET /api/v1/players/me/code", s.authed(s.linkCode))
	mux.HandleFunc("POST /api/v1/players/claim", s.claimCode)
	mux.HandleFunc("POST /api/v1/raids", s.authed(s.postRaid))
	mux.HandleFunc("GET /api/v1/leaderboard", s.leaderboard)
	return s.recover(s.cors(mux))
}

// ── Handlers ────────────────────────────────────────────────────────────────

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "db": s.store.Kind()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "db": s.store.Kind()})
}

func (s *Server) createPlayer(w http.ResponseWriter, r *http.Request) {
	if !s.register.allow(clientIP(r), s.now()) {
		writeErr(w, http.StatusTooManyRequests, "too many new players from this address, try later")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, maxSmallBody, &body) {
		return
	}
	token, hash := newToken()
	p := store.Player{ID: randomHex(12), Name: cleanName(body.Name), TokenHashes: []string{hash}, CreatedAt: s.now().UTC()}
	if err := s.store.CreatePlayer(r.Context(), p); err != nil {
		s.fail(w, "create player", err)
		return
	}
	code, err := s.newLinkCode(r.Context(), p.ID)
	if err != nil {
		s.fail(w, "link code", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"playerId": p.ID, "token": token, "code": code})
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request, p store.Player) {
	data, rev, err := s.store.GetProfile(r.Context(), p.ID)
	if err != nil {
		s.fail(w, "get profile", err)
		return
	}
	if data == nil {
		data = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": data, "rev": rev})
}

func (s *Server) putProfile(w http.ResponseWriter, r *http.Request, p store.Player) {
	var body struct {
		Profile json.RawMessage `json:"profile"`
		BaseRev int64           `json:"baseRev"`
	}
	if !readJSON(w, r, maxProfileBytes, &body) {
		return
	}
	var head struct {
		Name  string `json:"name"`
		XP    int64  `json:"xp"`
		Stats struct {
			Survived int64 `json:"survived"`
			Kills    int64 `json:"kills"`
		} `json:"stats"`
	}
	if len(body.Profile) == 0 || body.Profile[0] != '{' || json.Unmarshal(body.Profile, &head) != nil {
		writeErr(w, http.StatusBadRequest, "profile must be a JSON object")
		return
	}
	if body.BaseRev < 0 {
		writeErr(w, http.StatusBadRequest, "baseRev must be ≥ 0")
		return
	}
	st := store.Stats{Name: cleanName(head.Name), XP: clamp(head.XP, 0, 1e9), Survived: clamp(head.Stats.Survived, 0, 1e7), Kills: clamp(head.Stats.Kills, 0, 1e8)}
	rev, err := s.store.PutProfile(r.Context(), p.ID, body.Profile, body.BaseRev, st)
	if errors.Is(err, store.ErrConflict) {
		_, cur, _ := s.store.GetProfile(r.Context(), p.ID)
		writeJSON(w, http.StatusConflict, map[string]any{"error": "profile changed on another device", "rev": cur})
		return
	}
	if err != nil {
		s.fail(w, "put profile", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"rev": rev})
}

func (s *Server) linkCode(w http.ResponseWriter, r *http.Request, p store.Player) {
	code, err := s.newLinkCode(r.Context(), p.ID)
	if err != nil {
		s.fail(w, "link code", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": code})
}

func (s *Server) claimCode(w http.ResponseWriter, r *http.Request) {
	if !s.claim.allow(clientIP(r), s.now()) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, try later")
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, maxSmallBody, &body) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(body.Code))
	if len(code) != linkCodeLen {
		writeErr(w, http.StatusNotFound, "unknown or expired code")
		return
	}
	id, err := s.store.TakeLinkCode(r.Context(), code, s.now())
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "unknown or expired code")
		return
	}
	if err != nil {
		s.fail(w, "claim", err)
		return
	}
	token, hash := newToken()
	if err := s.store.AddTokenHash(r.Context(), id, hash); err != nil {
		s.fail(w, "claim token", err)
		return
	}
	// A new device may have pushed the oldest token out: forget this player's cached tokens here.
	s.auth.DeleteFunc(func(p store.Player) bool { return p.ID == id })
	writeJSON(w, http.StatusOK, map[string]string{"playerId": id, "token": token})
}

var raidStatuses = map[string]bool{"extracted": true, "dead": true, "mia": true}

func (s *Server) postRaid(w http.ResponseWriter, r *http.Request, p store.Player) {
	var body store.Raid
	if !readJSON(w, r, maxSmallBody, &body) {
		return
	}
	if !raidStatuses[body.Status] || body.Kills < 0 || body.Kills > 500 || body.XP < 0 || body.XP > 1_000_000 || body.Duration < 0 || body.Duration > 6*3600 {
		writeErr(w, http.StatusBadRequest, "invalid raid")
		return
	}
	body.PlayerID = p.ID
	body.At = s.now().UTC()
	if err := s.store.AddRaid(r.Context(), body); err != nil {
		s.fail(w, "add raid", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type boardEntry struct {
	Name     string `json:"name"`
	Level    int    `json:"level"`
	XP       int64  `json:"xp"`
	Survived int64  `json:"survived"`
	Kills    int64  `json:"kills"`
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	now := s.now()
	entries, ok := s.board.Get(struct{}{}, now)
	if !ok {
		players, err := s.store.Leaderboard(r.Context(), leaderboardSize)
		if err != nil {
			s.fail(w, "leaderboard", err)
			return
		}
		entries = make([]boardEntry, 0, len(players))
		for _, p := range players {
			entries = append(entries, boardEntry{Name: p.Name, Level: LevelFromXP(p.XP), XP: p.XP, Survived: p.Survived, Kills: p.Kills})
		}
		s.board.Set(struct{}{}, entries, now)
	}
	w.Header().Set("Cache-Control", "public, max-age=30")
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// ── Auth ────────────────────────────────────────────────────────────────────

type authedHandler func(http.ResponseWriter, *http.Request, store.Player)

func (s *Server) authed(h authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || len(token) != tokenBytes*2 {
			writeErr(w, http.StatusUnauthorized, "missing or malformed token")
			return
		}
		hash := hashToken(token)
		now := s.now()
		p, ok := s.auth.Get(hash, now)
		if !ok {
			var err error
			p, err = s.store.PlayerByTokenHash(r.Context(), hash)
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, http.StatusUnauthorized, "unknown token")
				return
			}
			if err != nil {
				s.fail(w, "auth", err)
				return
			}
			s.auth.Set(hash, p, now)
		}
		h(w, r, p)
	}
}

const tokenBytes = 32

// newToken returns a bearer token and the SHA-256 we store (a leaked database doesn't leak logins).
func newToken() (token, hash string) {
	token = randomHex(tokenBytes)
	return token, hashToken(token)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Link codes avoid look-alike characters (0/O, 1/I/L) since people type them from another screen.
const (
	linkAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	linkCodeLen  = 8
)

func (s *Server) newLinkCode(ctx context.Context, playerID string) (string, error) {
	b := make([]byte, linkCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = linkAlphabet[int(b[i])%len(linkAlphabet)]
	}
	code := string(b)
	return code, s.store.SaveLinkCode(ctx, code, playerID, s.now().Add(linkCodeTTL))
}

// LevelFromXP mirrors levelFromXp in packages/engine/src/profile.ts.
func LevelFromXP(xp int64) int {
	level, need, rest := 1, 1000.0, float64(xp)
	for rest >= need {
		rest -= need
		level++
		need = float64(int64(need*1.25 + 0.5))
	}
	return level
}

// ── Plumbing ────────────────────────────────────────────────────────────────

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && s.originAllowed(origin) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Max-Age", "86400")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) originAllowed(origin string) bool {
	if len(s.origins) == 0 {
		return true
	}
	for _, o := range s.origins {
		if o == "*" || o == origin {
			return true
		}
		// "*.vercel.app" style wildcard for preview deployments.
		if rest, ok := strings.CutPrefix(o, "*."); ok && strings.HasSuffix(origin, "."+rest) {
			return true
		}
	}
	return false
}

func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "path", r.URL.Path, "err", v)
				writeErr(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) fail(w http.ResponseWriter, what string, err error) {
	s.log.Error(what, "err", err)
	writeErr(w, http.StatusInternalServerError, "internal error")
}

func readJSON(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, http.StatusRequestEntityTooLarge, "body too large")
		} else {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
		}
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func cleanName(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		return "Survivor"
	}
	if utf8.RuneCountInString(name) > 24 {
		name = string([]rune(name)[:24])
	}
	return name
}

func clamp(v, lo, hi int64) int64 {
	return max(lo, min(hi, v))
}

// clientIP: Railway (and most PaaS) put the caller first in X-Forwarded-For.
func clientIP(r *http.Request) string {
	// The edge proxy (Railway) appends the address it saw, so the last entry is the one we can trust;
	// anything to its left came from the client and could be forged to dodge the rate limits.
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		parts := strings.Split(f, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	return host
}
