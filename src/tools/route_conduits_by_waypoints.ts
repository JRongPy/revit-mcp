import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";

/**
 * Normalize a single routing task into the shape expected by ConduitRouteTaskInfo.
 *
 * 支援多種 key 風格：
 *  - startElementId / StartElementId / start_element_id
 *  - waypoints / Waypoints / way_points / WAYPOINTS
 *  - minSegmentLengthMm / MinSegmentLengthMm / minSegmentLength_mm ...
 *  - trayOffsetMm / TrayOffsetMm / tray_offset_mm ...
 *  - toleranceMm / ToleranceMm / tolerance_mm ...
 *  - toleranceDeg / ToleranceDeg / angleTolerance_deg ...
 *  - conduitDiameterMm / ConduitDiameterMm / diameter_mm ...
 *
 * Waypoints：世界座標（mm），會轉成 { X, Y, Z } 給 C# 的 JZPoint。
 */
function normalizeConduitTask(input: any) {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid task payload.");
  }

  // ---- 必填：Start / End ----
  const startElementId =
    input.startElementId ??
    input.StartElementId ??
    input.start_element_id;

  const endElementId =
    input.endElementId ??
    input.EndElementId ??
    input.end_element_id;

  if (typeof startElementId !== "number" || typeof endElementId !== "number") {
    throw new Error("Task requires startElementId and endElementId (number).");
  }

  // ---- Waypoints ----
  const rawWps =
    input.waypoints ??
    input.Waypoints ??
    input.way_points ??
    input.WAYPOINTS ??
    [];

  const waypoints = Array.isArray(rawWps)
    ? rawWps.map((p) => ({
        // 傳成 X/Y/Z，對應 C# JZPoint.X/Y/Z（mm）
        X: Number(p.x ?? p.X),
        Y: Number(p.y ?? p.Y),
        Z: Number(p.z ?? p.Z),
      }))
    : [];

  // ---- 其他數值欄位（mm / deg）----
  const minSegmentLengthMm =
    input.minSegmentLengthMm ??
    input.MinSegmentLengthMm ??
    input.minSegmentLength_mm ??
    input.MinSegmentLength_mm ??
    input.MinSegmentLengthMM;

  const trayOffsetMm =
    input.trayOffsetMm ??
    input.TrayOffsetMm ??
    input.tray_offset_mm ??
    input.TrayOffset_mm ??
    input.TrayOffsetMM;

  const toleranceMm =
    input.toleranceMm ??
    input.ToleranceMm ??
    input.tolerance_mm ??
    input.Tolerance_mm ??
    input.ToleranceMM;

  const angleToleranceDeg =
    input.toleranceDeg ??
    input.ToleranceDeg ??
    input.angleTolerance_deg ??
    input.AngleTolerance_deg ??
    input.AngleToleranceDEG;

  // ---- 管徑（mm），對應 ConduitRouteTaskInfo.ConduitDiameterMm ----
  const diameterMm =
    input.conduitDiameterMm ??
    input.ConduitDiameterMm ??
    input.diameter_mm ??
    input.Diameter_mm ??
    input.DiameterMM;

  // ---- Override block：ConduitRouteOverrideOptions ----
  const overrideRaw = input.override ?? input.Override;
  let override: any | undefined;
  if (overrideRaw && typeof overrideRaw === "object") {
    const conduitTypeId =
      overrideRaw.conduitTypeId ?? overrideRaw.ConduitTypeId;
    const levelId =
      overrideRaw.levelId ?? overrideRaw.LevelId;
    const oDiameterMm =
      overrideRaw.diameterMm ??
      overrideRaw.DiameterMm ??
      overrideRaw.diameter_mm ??
      overrideRaw.Diameter_mm ??
      overrideRaw.DiameterMM;

    const o: any = {};
    if (conduitTypeId != null) o.ConduitTypeId = Number(conduitTypeId);
    if (levelId != null) o.LevelId = Number(levelId);
    if (oDiameterMm != null) o.DiameterMm = Number(oDiameterMm);

    if (Object.keys(o).length > 0) {
      override = o;
    }
  }

  // ---- 組成 C# 端預期的 ConduitRouteTaskInfo JSON ----
  const task: any = {
    StartElementId: Number(startElementId),
    EndElementId: Number(endElementId),
  };

  if (waypoints.length > 0) {
    task.Waypoints = waypoints;
  }
  if (minSegmentLengthMm != null) {
    task.MinSegmentLengthMm = Number(minSegmentLengthMm);
  }
  if (trayOffsetMm != null) {
    task.TrayOffsetMm = Number(trayOffsetMm);
  }
  if (toleranceMm != null) {
    task.ToleranceMm = Number(toleranceMm);
  }
  if (angleToleranceDeg != null) {
    task.ToleranceDeg = Number(angleToleranceDeg);
  }
  if (diameterMm != null) {
    // 若 client 有給就覆寫；沒給則讓 C# 用預設 53mm
    task.ConduitDiameterMm = Number(diameterMm);
  }
  if (override) {
    task.Override = override;
  }

  return task;
}

/**
 * MCP tool:
 *  - name: route_conduits_by_waypoints
 *  - payload:
 *      { task: {...} }         // 單筆
 *      { tasks: [{...}, ...] } // 批次
 *
 * 跟原本 route_pipes_by_waypoints 的使用方式一樣，只是改成 Conduit 版本。
 */
export function registerRouteConduitsByWaypointsTool(server: McpServer) {
  server.tool(
    "route_conduits_by_waypoints",
    "Route conduits between start/end with optional waypoints (mm). Supports single {task} or batch {tasks}.",
    {
      task: z.any().optional(),
      tasks: z.array(z.any()).optional(),
      parallel: z.boolean().optional(),
      stopOnError: z.boolean().optional(),
    },
    async (args, _extra) => {
      try {
        const rawTasks: any[] =
          args?.tasks ??
          (args?.task ? [args.task] : []);

        if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
          throw new Error("Provide either { task } or { tasks }.");
        }

        const tasks = rawTasks.map(normalizeConduitTask);
        const parallel = Boolean(args?.parallel);
        const stopOnError = Boolean(args?.stopOnError);

        const execOne = async (task: any) => {
          return await withRevitConnection(async (revitClient) => {
            return await revitClient.sendCommand("route_conduits_by_waypoints", {
              task,
            });
          });
        };

        const results: any[] = [];

        if (parallel) {
          const settled = await Promise.all(
            tasks.map((t, i) =>
              execOne(t)
                .then((resp) => ({ index: i, ok: true, response: resp }))
                .catch((e) => ({
                  index: i,
                  ok: false,
                  error: e instanceof Error ? e.message : String(e),
                })),
            ),
          );
          results.push(...settled);
        } else {
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

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  summary: {
                    total: tasks.length,
                    succeeded: results.filter((r) => r.ok).length,
                    failed: results.filter((r) => !r.ok).length,
                  },
                  results,
                },
                null,
                2,
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
                "Route conduits failed: " +
                (error instanceof Error ? error.message : String(error)),
            },
          ],
        };
      }
    },
  );
}

