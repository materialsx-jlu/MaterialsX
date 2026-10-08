package mxpoints

import (
	"context"
	"encoding/json"
	"time"
)

// UsageRow is the customer's MX reservation and its pinned route/price receipt.
// Null usage and charge mean unknown, never zero.
type UsageRow struct {
	RequestID            string          `json:"requestId"`
	TaskID               *string         `json:"taskId"`
	ModelID              string          `json:"modelId"`
	RouteVersionID       string          `json:"routeVersionId"`
	RetailPriceVersionID string          `json:"retailPriceVersionId"`
	ReservedPoints       string          `json:"reservedPoints"`
	ChargedPoints        *string         `json:"chargedPoints"`
	State                string          `json:"state"`
	Usage                json.RawMessage `json:"usage"`
	UsageEvidenceRef     *string         `json:"usageEvidenceRef"`
	CreatedAt            time.Time       `json:"createdAt"`
}

func (s *Store) Usage(ctx context.Context, owner string) ([]UsageRow, error) {
	rows, err := s.Pool.Query(ctx, `SELECT p.request_id,p.task_id,p.model_id,p.route_version,p.retail_version_id,
 r.reserved,r.charged,r.state,p.usage,p.usage_evidence_ref,p.created_at
 FROM mx_priced_reservations p JOIN mx_point_reservations r ON r.id=p.request_id AND r.account_id=p.account_id
 WHERE p.account_id=$1 ORDER BY p.created_at DESC,p.request_id DESC LIMIT 100`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]UsageRow, 0)
	for rows.Next() {
		var item UsageRow
		var reserved int64
		var charged *int64
		if err = rows.Scan(&item.RequestID, &item.TaskID, &item.ModelID, &item.RouteVersionID, &item.RetailPriceVersionID, &reserved, &charged, &item.State, &item.Usage, &item.UsageEvidenceRef, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.ReservedPoints = Points(reserved)
		if charged != nil {
			v := Points(*charged)
			item.ChargedPoints = &v
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
