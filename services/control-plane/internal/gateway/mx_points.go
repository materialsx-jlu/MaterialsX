package gateway

import (
	"net/http"

	"github.com/jamip/materialsx/control-plane/internal/mxpoints"
)

func MountMXPoints(parent *HTTP, s *mxpoints.Store) {
	parent.MXPoints = s
	parent.S.MXPoints = s
	i := parent.Identity
	i.Mount("GET /v1/mx-points/products", parent.mxProducts)
	i.Mount("GET /v1/mx-points/prices", parent.mxPrices)
	i.Mount("GET /v1/mx-points/wallet", parent.mxWallet)
	i.Mount("GET /v1/mx-points/usage", parent.mxUsage)
	i.Mount("GET /v1/mx-points/orders", parent.mxOrders)
	i.Mount("POST /v1/mx-points/orders", parent.mxCreate)
	i.Mount("GET /v1/mx-points/orders/{id}", parent.mxOrder)
	i.Mount("POST /v1/mx-points/orders/{id}/cancel", parent.mxCancel)
	i.Mount("GET /v1/mx-points/orders/{id}/refunds", parent.mxRefunds)
	i.Mount("POST /v1/mx-points/orders/{id}/refunds", parent.mxRefundRequest)
	i.Mount("GET /v1/mx-points/refunds/{id}", parent.mxRefund)
}
func (h *HTTP) mxUsage(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	items, err := h.MXPoints.Usage(r.Context(), p.ID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (h *HTTP) mxPrices(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.auth(w, r); !ok {
		return
	}
	catalog, err := h.MXPoints.RetailCatalog(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, catalog)
}
func (h *HTTP) mxProducts(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	items, err := h.MXPoints.Products(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	pilotAllowed := h.MXPoints.PilotAccount == "" || h.MXPoints.PilotAccount == p.ID
	for index := range items {
		if h.MXPoints.PilotAccount != "" && (!pilotAllowed || items[index].ID != "mx-cny-10-v1") {
			items[index].Enabled = false
		}
	}
	writeJSON(w, 200, map[string]any{"items": items, "unit": "mx-point", "salesEnabled": (h.MXPoints.Mode == "wechat" && pilotAllowed) || h.MXPoints.Mode == "wechat-live" || h.MXPoints.Mode == "wechat-production" && h.MXPoints.ProductionReady(r.Context()), "testMode": h.MXPoints.Mode == "test"})
}
func (h *HTTP) mxWallet(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	wallet, err := h.MXPoints.Wallet(r.Context(), p.ID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, wallet)
}
func (h *HTTP) mxOrders(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	items, err := h.MXPoints.Orders(r.Context(), p.ID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (h *HTTP) mxCreate(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		ProductVersionID string `json:"productVersionId"`
	}
	if !decode(w, r, &in) {
		return
	}
	order, err := h.MXPoints.Create(r.Context(), p.ID, r.Header.Get("Idempotency-Key"), in.ProductVersionID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, order)
}
func (h *HTTP) mxOrder(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	order, err := h.MXPoints.Order(r.Context(), p.ID, r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, order)
}
func (h *HTTP) mxCancel(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	order, err := h.MXPoints.Cancel(r.Context(), p.ID, r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, order)
}
func (h *HTTP) mxRefundRequest(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	refund, err := h.MXPoints.RequestRefund(r.Context(), p.ID, r.Header.Get("Idempotency-Key"), r.PathValue("id"), in.Reason)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, refund)
}
func (h *HTTP) mxRefund(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	refund, err := h.MXPoints.Refund(r.Context(), p.ID, r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, refund)
}
func (h *HTTP) mxRefunds(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	items, err := h.MXPoints.Refunds(r.Context(), p.ID, r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
