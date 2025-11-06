import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";

/**
 * Normalize a single routing task into the camelCase shape expected by Revit command.
 * Accepts either:
 *  - camelCase: { startElementId, endElementId, waypoints, ... }
 *  - PascalCase: { StartElementId, EndElementId, Waypoints, ... }
 * Waypoints are world coords in mm.
 */
function normalizeTask(input: any) {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid task payload.");
  }

  // Prefer camelCase, fallback to PascalCase
  const startElementId =
    input.startElementId ?? input.StartElementId ?? input.start_element_id;
  const endElementId =
    input.endElementId ?? input.EndElementId ?? input.end_element_id;

  if (typeof startElementId !== "number" || typeof endElementId !== "number") {
    throw new Error("Task requires startElementId and endElementId (number).");
  }

  // Waypoints normalization
  const rawWps =
    input.waypoints ?? input.Waypoints ?? input.way_points ?? input.WAYPOINTS ?? [];

  const waypoints =
    Array.isArray(rawWps)
      ? rawWps.map((p) => ({
          x: Number(p.x ?? p.X),
          y: Number(p.y ?? p.Y),
          z: Number(p.z ?? p.Z),
        }))
      : [];

  // Optional fields (accept both cases if present)
  const systemTypeId = input.systemTypeId ?? input.SystemTypeId;
  const pipeTypeId = input.pipeTypeId ?? input.PipeTypeId;
  const levelId = input.levelId ?? input.LevelId;
  const diameter_mm = input.diameter_mm ?? input.Diameter_mm ?? input.DiameterMM;
  const minSegmentLength_mm =
    input.minSegmentLength_mm ??
    input.MinSegmentLength_mm ??
    input.MinSegmentLengthMM;
  const tolerance_mm = input.tolerance_mm ?? input.Tolerance_mm ?? input.ToleranceMM;
  const angleTolerance_deg =
    input.angleTolerance_deg ?? input.AngleTolerance_deg ?? input.AngleToleranceDEG;
  const routingPreference =
    input.routingPreference ?? input.RoutingPreference ?? input.routing_preference;

  const task = {
    startElementId,
    endElementId,
    waypoints,
    ...(systemTypeId != null ? { systemTypeId: Number(systemTypeId) } : {}),
    ...(pipeTypeId != null ? { pipeTypeId: Number(pipeTypeId) } : {}),
    ...(levelId != null ? { levelId: Number(levelId) } : {}),
    ...(diameter_mm != null ? { diameter_mm: Number(diameter_mm) } : {}),
    ...(minSegmentLength_mm != null
      ? { minSegmentLength_mm: Number(minSegmentLength_mm) }
      : {}),
    ...(tolerance_mm != null ? { tolerance_mm: Number(tolerance_mm) } : {}),
    ...(angleTolerance_deg != null
      ? { angleTolerance_deg: Number(angleTolerance_deg) }
      : {}),
    ...(routingPreference != null ? { routingPreference: String(routingPreference) } : {}),
  };

  return task;
}

/**
 * Accepts either:
 *  - { task: {...} }  -> single route
 *  - { tasks: [{...}, {...}] } -> batch route
 * Mixed key-styles for tasks are accepted (camelCase or PascalCase).
 * Units: all distances in mm.
 * Revit command: "route_pipes_by_waypoints"
 */
export function registerRoutePipesByWaypointsTool(server: McpServer) {
  server.tool(
    "route_pipes_by_waypoints",
    "Route pipes between start/end with optional waypoints (mm). Supports single {task} or batch {tasks}. Optional system/pipe/level/diameter/tolerances.",
    {
      // 放寬 schema 方便吃到多種鍵名；內部再做嚴格 normalize 與檢查
      task: z.any().optional(),
      tasks: z.array(z.any()).optional(),
      // 預留 flags：若未來要改為平行執行，可設 true
      parallel: z.boolean().optional().describe("Execute tasks in parallel (default false)."),
      stopOnError: z
        .boolean()
        .optional()
        .describe("Stop entire batch on first error (default false)."),
    },
    async (args, _extra) => {
      try {
        // 收斂成 tasks 陣列
        const rawTasks: any[] =
          args?.tasks ??
          (args?.task ? [args.task] : []);

        if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
          throw new Error(
            "Provide either { task: {...} } or { tasks: [{...}, ...] }."
          );
        }

        // 規範化所有任務
        const tasks = rawTasks.map(normalizeTask);

        const parallel = Boolean(args?.parallel) === true;
        const stopOnError = Boolean(args?.stopOnError) === true;

        // 執行器：預設序列化執行，避免 Revit ExternalEvent 競態
        const execOne = async (task: any) => {
          return await withRevitConnection(async (revitClient) => {
            return await revitClient.sendCommand("route_pipes_by_waypoints", { task });
          });
        };

        const results: Array<{
          index: number;
          ok: boolean;
          response?: any;
          error?: string;
        }> = [];

        if (parallel) {
          // 並行（如果你確定 Revit 端具備安全併發處理才開）
          const promises = tasks.map((t, i) =>
            execOne(t)
              .then((resp) => ({ index: i, ok: true, response: resp }))
              .catch((e) => ({
                index: i,
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              }))
          );
          const settled = await Promise.all(promises);
          results.push(...settled);
        } else {
          // 預設序列
          for (let i = 0; i < tasks.length; i++) {
            try {
              const resp = await execOne(tasks[i]);
              results.push({ index: i, ok: true, response: resp });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              results.push({ index: i, ok: false, error: msg });
              if (stopOnError) break;
            }
          }
        }

        const summary = {
          total: tasks.length,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  summary,
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text:
                "Route pipes (single/batch) failed: " +
                (error instanceof Error ? error.message : String(error)),
            },
          ],
        };
      }
    }
  );
}
