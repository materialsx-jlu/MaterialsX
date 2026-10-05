// Package rootflow contains bounded integration probes, not a production gateway.
package rootflow

import (
	"encoding/json"
	"errors"
	"math/big"
)

type Usage struct {
	Source    string `json:"source"`
	Input     *int64 `json:"inputTokens"`
	Output    *int64 `json:"outputTokens"`
	Cached    *int64 `json:"cachedInputTokens"`
	Uncached  *int64 `json:"uncachedInputTokens"`
	Reasoning *int64 `json:"reasoningTokens"`
}

func NormalizeUsage(raw json.RawMessage, protocol string) (Usage, error) {
	u := Usage{Source: protocol}
	if len(raw) == 0 || string(raw) == "null" {
		return u, nil
	}
	var fields struct {
		Input        *int64 `json:"input_tokens"`
		Output       *int64 `json:"output_tokens"`
		Prompt       *int64 `json:"prompt_tokens"`
		Completion   *int64 `json:"completion_tokens"`
		InputDetails *struct {
			Cached *int64 `json:"cached_tokens"`
		} `json:"input_tokens_details"`
		PromptDetails *struct {
			Cached *int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
		OutputDetails *struct {
			Reasoning *int64 `json:"reasoning_tokens"`
		} `json:"output_tokens_details"`
		CompletionDetails *struct {
			Reasoning *int64 `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	}
	if json.Unmarshal(raw, &fields) != nil {
		return u, errors.New("invalid_usage")
	}
	switch protocol {
	case "responses":
		u.Input, u.Output = fields.Input, fields.Output
		if fields.InputDetails != nil {
			u.Cached = fields.InputDetails.Cached
		}
		if fields.OutputDetails != nil {
			u.Reasoning = fields.OutputDetails.Reasoning
		}
	case "chat-completions":
		u.Input, u.Output = fields.Prompt, fields.Completion
		if fields.PromptDetails != nil {
			u.Cached = fields.PromptDetails.Cached
		}
		if fields.CompletionDetails != nil {
			u.Reasoning = fields.CompletionDetails.Reasoning
		}
	default:
		return u, errors.New("invalid_protocol")
	}
	for _, v := range []*int64{u.Input, u.Output, u.Cached, u.Reasoning} {
		if v != nil && (*v < 0 || *v > 9007199254740991) {
			return u, errors.New("invalid_usage")
		}
	}
	if u.Cached != nil && u.Input != nil {
		if *u.Cached > *u.Input {
			return u, errors.New("cache_exceeds_input")
		}
		v := *u.Input - *u.Cached
		u.Uncached = &v
	}
	if u.Reasoning != nil && u.Output != nil && *u.Reasoning > *u.Output {
		return u, errors.New("reasoning_exceeds_output")
	}
	return u, nil
}

// QuoteFen is a conservative text-only bound with no cache discount. Inputs are
// effective fen per million tokens; reasoning is included in output, not added.
// One ceil is applied after summing numerators; intermediate products use big.Int.
func QuoteFen(input, output, inputPrice, outputPrice int64) (int64, error) {
	if input < 0 || output < 0 || inputPrice < 0 || outputPrice < 0 {
		return 0, errors.New("negative_quote_value")
	}
	n := new(big.Int).Mul(big.NewInt(input), big.NewInt(inputPrice))
	n.Add(n, new(big.Int).Mul(big.NewInt(output), big.NewInt(outputPrice)))
	n.Add(n, big.NewInt(999999))
	n.Div(n, big.NewInt(1000000))
	if !n.IsInt64() {
		return 0, errors.New("quote_overflow")
	}
	return n.Int64(), nil
}
