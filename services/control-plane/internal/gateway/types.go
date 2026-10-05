package gateway

import (
	"encoding/json"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"time"
)

var (
	ErrReleaseGates  = errors.New("RELEASE_GATES_NOT_SATISFIED")
	ErrReleaseRemote = errors.New("PUBLIC_RELEASE_UNVERIFIED")
	ErrValidation    = errors.New("VALIDATION_ERROR")
	ErrForbidden     = errors.New("FORBIDDEN")
	ErrNotFound      = errors.New("NOT_FOUND")
	ErrConflict      = errors.New("OPERATION_CONFLICT")
	ErrIdempotency   = errors.New("IDEMPOTENCY_CONFLICT")
	ErrBudget        = errors.New("TASK_BUDGET_EXCEEDED")
	ErrUnavailable   = errors.New("MODEL_UNAVAILABLE")
	ErrRate          = errors.New("RATE_LIMITED")
)

type Limits struct {
	MaxCredits  string `json:"maxCredits,omitempty"`
	MaxRequests int    `json:"maxRequests"`
	MaxOutput   int    `json:"maxOutputTokensPerRequest"`
	MaxDuration int    `json:"maxDurationSeconds"`
}
type Consent struct {
	Policy  string `json:"policyVersion"`
	Prompt  bool   `json:"prompt"`
	History string `json:"history"`
	Files   int    `json:"fileCount"`
	Skills  int    `json:"skillCount"`
}
type CreateTask struct {
	ClientID string  `json:"clientTaskId"`
	Model    string  `json:"modelId"`
	Mode     string  `json:"billingMode"`
	Budget   Limits  `json:"budget"`
	Consent  Consent `json:"consent"`
}
type Task struct {
	ID       string    `json:"id"`
	ClientID string    `json:"clientTaskId"`
	Model    string    `json:"modelId"`
	Mode     string    `json:"billingMode"`
	Budget   Limits    `json:"budget"`
	Consent  Consent   `json:"consent"`
	State    string    `json:"state"`
	Quality  string    `json:"scientificQuality"`
	Created  time.Time `json:"createdAt"`
	Deadline time.Time `json:"deadline"`
	Requests int       `json:"requestCount"`
}
type Request struct {
	Phase      string          `json:"phase,omitempty"`
	ID         string          `json:"id"`
	TaskID     string          `json:"taskId"`
	Model      string          `json:"modelId"`
	Mode       string          `json:"billingMode"`
	Execution  string          `json:"execution"`
	Settlement string          `json:"settlement"`
	Quality    string          `json:"scientificQuality"`
	Usage      *rootflow.Usage `json:"usage"`
	Reserved   string          `json:"reservedCredits"`
	Charged    *string         `json:"chargedCredits"`
	Price      *string         `json:"salesPriceVersionId"`
	Route      string          `json:"routeVersionId"`
	Terminal   bool            `json:"terminalReceived"`
	Error      *string         `json:"errorCode"`
	Dispatched bool            `json:"dispatched"`
}

func fingerprint(v any) string { b, _ := json.Marshal(v); return hash(string(b)) }
