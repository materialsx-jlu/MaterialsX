package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/billing"
)

type Server struct {
	store   *billing.Store
	devMode bool
	mux     *http.ServeMux
}

func New(store *billing.Store, devMode bool) *Server {
	server := &Server{store: store, devMode: devMode, mux: http.NewServeMux()}
	server.routes()
	return server
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		s.mux.ServeHTTP(response, request)
	})
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{"status": "ok", "service": "materialsx-control-plane", "devMode": s.devMode})
	})
	s.mux.HandleFunc("GET /v1/plans", func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, http.StatusOK, billing.Plans())
	})
	s.mux.HandleFunc("GET /v1/entitlements/{accountID}", s.entitlement)
	s.mux.HandleFunc("GET /v1/ledger/{accountID}", s.ledger)
	s.mux.HandleFunc("POST /v1/dev/subscriptions", s.devSubscription)
	s.mux.HandleFunc("POST /v1/credits/reservations", s.reserve)
	s.mux.HandleFunc("POST /v1/credits/settlements", s.settle)
	s.mux.HandleFunc("POST /v1/credits/releases", s.release)
}

func (s *Server) entitlement(response http.ResponseWriter, request *http.Request) {
	accountID := strings.TrimSpace(request.PathValue("accountID"))
	overview, ok := s.store.Overview(accountID)
	if !ok {
		var err error
		overview, err = s.store.EnsureCommunity(accountID, time.Now())
		if err != nil {
			writeError(response, http.StatusInternalServerError, err)
			return
		}
	}
	writeJSON(response, http.StatusOK, overview)
}

func (s *Server) ledger(response http.ResponseWriter, request *http.Request) {
	writeJSON(response, http.StatusOK, s.store.Ledger(strings.TrimSpace(request.PathValue("accountID"))))
}

func (s *Server) devSubscription(response http.ResponseWriter, request *http.Request) {
	if !s.devMode {
		writeError(response, http.StatusNotFound, errors.New("development subscriptions are disabled"))
		return
	}
	var input struct {
		AccountID string `json:"accountId"`
		PlanID    string `json:"planId"`
		EventID   string `json:"eventId"`
	}
	if !decode(response, request, &input) {
		return
	}
	overview, err := s.store.GrantSubscription(input.AccountID, input.PlanID, input.EventID, time.Now())
	if err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	writeJSON(response, http.StatusOK, overview)
}

func (s *Server) reserve(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ID        string `json:"id"`
		AccountID string `json:"accountId"`
		RequestID string `json:"requestId"`
		Units     int64  `json:"units"`
	}
	if !decode(response, request, &input) {
		return
	}
	reservation, err := s.store.Reserve(input.ID, input.AccountID, input.RequestID, input.Units, time.Now())
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, billing.ErrInsufficientCredits) {
			status = http.StatusPaymentRequired
		}
		writeError(response, status, err)
		return
	}
	writeJSON(response, http.StatusOK, reservation)
}

func (s *Server) settle(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ReservationID string `json:"reservationId"`
		EventID       string `json:"eventId"`
		ActualUnits   *int64 `json:"actualUnits"`
	}
	if !decode(response, request, &input) {
		return
	}
	overview, err := s.store.Settle(input.ReservationID, input.EventID, input.ActualUnits, time.Now())
	if err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	writeJSON(response, http.StatusOK, overview)
}

func (s *Server) release(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ReservationID string `json:"reservationId"`
		EventID       string `json:"eventId"`
	}
	if !decode(response, request, &input) {
		return
	}
	overview, err := s.store.Release(input.ReservationID, input.EventID, time.Now())
	if err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	writeJSON(response, http.StatusOK, overview)
}

func decode(response http.ResponseWriter, request *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return false
	}
	return true
}

func writeError(response http.ResponseWriter, status int, err error) {
	writeJSON(response, status, map[string]string{"error": err.Error()})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
