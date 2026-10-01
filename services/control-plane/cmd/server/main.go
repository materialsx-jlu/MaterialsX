package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jamip/materialsx/control-plane/internal/billing"
	"github.com/jamip/materialsx/control-plane/internal/httpapi"
)

func main() {
	address := env("MATERIALSX_CONTROL_ADDR", "127.0.0.1:8787")
	dataDir := env("MATERIALSX_CONTROL_DATA", filepath.Join("runtime", "m3-control-plane"))
	store, err := billing.NewStore(filepath.Join(dataDir, "state.json"))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr:              address,
		Handler:           httpapi.New(store, os.Getenv("MATERIALSX_DEV_MODE") == "1").Handler(),
		ReadHeaderTimeout: 5_000_000_000,
	}
	log.Printf("MaterialsX control plane listening on http://%s", address)
	log.Fatal(server.ListenAndServe())
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
