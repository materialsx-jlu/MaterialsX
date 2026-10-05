package gateway
import("encoding/json";"testing")
func TestFrozenLocalScienceToolBoundary(t *testing.T){
 var schema any
 if err:=json.Unmarshal(scienceParameters,&schema);err!=nil{t.Fatal(err)}
 payload:=func()map[string]any{return map[string]any{"model":ModelAlias,"stream":true,"max_output_tokens":float64(128),"store":false,"input":"synthetic science request","tools":[]any{map[string]any{"type":"function","name":"materials_science","description":"Trusted bounded local dispatcher","parameters":schema}}}}
 if err:=ValidateNative(payload(),128);err!=nil{t.Fatal(err)}
 for _,change:=range []func(map[string]any){
  func(p map[string]any){p["tools"].([]any)[0].(map[string]any)["name"]="bash"},
  func(p map[string]any){p["tools"].([]any)[0].(map[string]any)["parameters"]=map[string]any{"type":"object","additionalProperties":true}},
  func(p map[string]any){p["tools"].([]any)[0].(map[string]any)["parameters"]=map[string]any{"type":"object","properties":map[string]any{"script":map[string]any{"type":"string"}}}},
  func(p map[string]any){p["tools"]=append(p["tools"].([]any),map[string]any{"type":"function","name":"materials_science","description":"duplicate","parameters":schema})},
 }{p:=payload();change(p);if ValidateNative(p,128)==nil{t.Fatal("unsafe science tool accepted")}}
}
