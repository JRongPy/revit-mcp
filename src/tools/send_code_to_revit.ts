import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";

export function registerSendCodeToRevitTool(server: McpServer) {
  server.tool(
    "send_code_to_revit",
    "Send C# code to Revit for execution. The code will be inserted into a template with access to the Revit Document and parameters. Your code runs inside CodeExecutor.Execute(Document document, object[] parameters).",
    {
      code: z
        .string()
        .min(1, "code cannot be empty")
        .describe(
          "C# code to execute inside CodeExecutor.Execute(...). Do NOT declare namespaces here; write method-body code."
        ),
      classes: z
        .string()
        .optional()
        .describe(
          "Optional C# class/record/enum helpers inserted into CodeExecutor class scope (before Execute)."
        ),
      parameters: z
        .array(z.any())
        .optional()
        .describe("Optional parameters passed as object[] to your code."),
      autoTransaction: z
        .boolean()
        .optional()
        .describe("Wrap execution in a Revit Transaction (default: true)."),
      transactionName: z
        .string()
        .optional()
        .describe("Custom Revit transaction name."),
    },
    async (args, extra) => {
      // Normalize args with sensible defaults
      const params: Record<string, unknown> = {
        code: (args.code ?? "").toString(),
        classes:
          typeof args.classes === "string" && args.classes.length > 0
            ? args.classes
            : undefined, // omit if empty to keep payload clean
        parameters: Array.isArray(args.parameters) ? args.parameters : [],
        autoTransaction:
          typeof args.autoTransaction === "boolean"
            ? args.autoTransaction
            : true,
        transactionName:
          typeof args.transactionName === "string" &&
          args.transactionName.trim().length > 0
            ? args.transactionName.trim()
            : "Execute AI code",
      };

      try {
        const response = await withRevitConnection(async (revitClient) => {
          return await revitClient.sendCommand("send_code_to_revit", params);
        });

        // Revit 端回傳格式預期為：
        // { success: boolean, result: string | null, errorMessage: string }
        // 若 result 是 JSON 字串，嘗試 parse 以方便後續使用。
        let parsedResult: unknown = response?.result;
        if (typeof parsedResult === "string") {
          const trimmed = parsedResult.trim();
          if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
          ) {
            try {
              parsedResult = JSON.parse(trimmed);
            } catch {
              // 保留原字串
            }
          }
        }

        const pretty = {
          success: !!response?.success,
          result: parsedResult,
          errorMessage: response?.errorMessage ?? "",
        };

        return {
          content: [
            {
              type: "text",
              text:
                "Code execution successful!\n" +
                JSON.stringify(pretty, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Code execution failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
