import { CortiClient } from "@corti/sdk";
import {
  buildAgentDefinitions,
  buildProvisioningSummary,
} from "../src/agent/definitions.js";
import { parseConfig } from "../src/config.js";

const config = parseConfig(process.env);
const client = new CortiClient({
  environment: config.corti.environment,
  tenantName: config.corti.tenantName,
  auth: {
    clientId: config.corti.clientId,
    clientSecret: config.corti.clientSecret,
  },
  analytics: { examples_repo: "team-13-follow-through" },
});
const definitions = buildAgentDefinitions(config);
const taskAgent = config.cortiAgentId
  ? await client.agents.update(config.cortiAgentId, definitions.task)
  : await client.agents.create(definitions.task);
const handoverAgent = config.cortiHandoverAgentId
  ? await client.agents.update(
      config.cortiHandoverAgentId,
      definitions.handover,
    )
  : await client.agents.create(definitions.handover);
const meetingAgent = config.cortiMeetingAgentId
  ? await client.agents.update(config.cortiMeetingAgentId, definitions.meeting)
  : await client.agents.create(definitions.meeting);

console.log(
  JSON.stringify(
    buildProvisioningSummary(
      config,
      taskAgent.id,
      handoverAgent.id,
      meetingAgent.id,
    ),
    null,
    2,
  ),
);
