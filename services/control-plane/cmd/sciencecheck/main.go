// Offline contract check for the actual Pi native wire payload; never calls a provider.
package main
import("encoding/json";"fmt";"io";"os";"github.com/jamip/materialsx/control-plane/internal/gateway")
func main(){data,err:=io.ReadAll(io.LimitReader(os.Stdin,256*1024+1));if err!=nil||len(data)>256*1024{os.Exit(1)};var p map[string]any;if json.Unmarshal(data,&p)!=nil||gateway.ValidateNative(p,4096)!=nil{fmt.Fprintln(os.Stderr,"NATIVE_SCIENCE_BOUNDARY_REJECTED");os.Exit(1)};fmt.Println("NATIVE_SCIENCE_BOUNDARY_PASSED")}
