import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";

/**
 * Route pipes between start/end with optional waypoints.
 * Units: millimeters (mm) for all distances.
 * The Revit-side command name is "route_pipes_by_waypoints".
 */
export function registerRoutePipesByWaypointsTool(server: McpServer) {
  server.tool(
    "route_pipes_by_waypoints",
    "Route pipes between startElementId and endElementId with optional waypoints (mm). Supports optional system/pipe/level/diameter/tolerances.",
    {
      task: z
        .object({
          startElementId: z.number().int().describe("Revit elementId of start"),
          endElementId: z.number().int().describe("Revit elementId of end"),
          waypoints: z
            .array(
              z.object({
                x: z.number().describe("X in mm"),
                y: z.number().describe("Y in mm"),
                z: z.number().describe("Z in mm"),
              })
            )
            .default([])
            .describe("Intermediate points in world coordinates (mm)"),
          // Optional routing context (all mm)
          systemTypeId: z.number().int().optional().describe("MEP SystemType Id"),
          pipeTypeId: z.number().int().optional().describe("PipeType Id"),
          levelId: z.number().int().optional().describe("Level Id"),
          diameter_mm: z.number().optional().describe("Pipe diameter in mm"),
          minSegmentLength_mm: z
            .number()
            .optional()
            .describe("Minimum segment length in mm"),
          tolerance_mm: z
            .number()
            .optional()
            .describe("Geometric tolerance in mm"),
          angleTolerance_deg: z
            .number()
            .optional()
            .describe("Angle tolerance in degrees"),
          routingPreference: z
            .string()
            .optional()
            .describe("Custom routing preference tag/name"),
        })
        .describe("Routing task payload"),
    },
    async (args, _extra) => {
      const payload = args; // { task: {...} }

      try {
        const response = await withRevitConnection(async (revitClient) => {
          // Pass directly to your Revit CommandSet handler
          return await revitClient.sendCommand(
            "route_pipes_by_waypoints",
            payload
          );
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text:
                "Route pipes failed: " +
                (error instanceof Error ? error.message : String(error)),
            },
          ],
        };
      }
    }
  );
}
