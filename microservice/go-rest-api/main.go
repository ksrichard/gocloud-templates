package {{go_module_name.Value}}

import (
	"github.com/gin-gonic/gin"
	"os"
)

var ROOT_PATH = os.Getenv("ROOT_PATH")
var QUERY_PATH = os.Getenv("QUERY_PATH")
var HEALTH_CHECK_PATH = os.Getenv("HEALTH_CHECK_PATH")

func main() {
	// web server
	r := gin.Default()
	root := r.Group(ROOT_PATH)
	{
		root.GET(HEALTH_CHECK_PATH, func(c *gin.Context) {
			c.Status(200)
		})
	}
	r.Run()
}
