// Command server runs the Ashfall backend: profile sync across devices, raid history and a leaderboard.
//
// Configuration (environment):
//
//	PORT             listen port (Railway sets this; default 8080)
//	MONGODB_URI      Mongo connection string; without it the server keeps data in memory
//	MONGODB_DB       database name (default "ashfall")
//	ALLOWED_ORIGINS  comma-separated CORS origins, e.g. "https://ashfall-two.vercel.app,*.vercel.app"
//	MONGODB_POOL     max connections in the Mongo pool (default 100)
//	REGISTER_PER_HOUR new accounts allowed per client IP per hour (default 10)
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/trusthemind/game/server/internal/api"
	"github.com/trusthemind/game/server/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var st store.Store
	if uri := os.Getenv("MONGODB_URI"); uri != "" {
		db := envOr("MONGODB_DB", "ashfall")
		cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		m, err := store.NewMongo(cctx, uri, db, uint64(envInt("MONGODB_POOL", 100)))
		cancel()
		if err != nil {
			return err
		}
		st = m
		log.Info("store", "kind", "mongo", "db", db)
	} else {
		st = store.NewMemory()
		log.Warn("store", "kind", "memory", "note", "MONGODB_URI not set: data is lost on restart")
	}

	var origins []string
	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	srv := &http.Server{
		Addr:              ":" + envOr("PORT", "8080"),
		Handler:           api.New(st, api.Options{AllowedOrigins: origins, Logger: log, RegisterPerHour: envInt("REGISTER_PER_HOUR", 10)}).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
	return st.Close(sctx)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}
