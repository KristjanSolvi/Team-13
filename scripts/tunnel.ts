import ngrok from "@ngrok/ngrok";

const authtoken = process.env.NGROK_AUTHTOKEN?.trim();
if (!authtoken || authtoken.startsWith("replace-with-")) {
  throw new Error("NGROK_AUTHTOKEN must be configured");
}
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

const listener = await ngrok.forward({
  addr: `127.0.0.1:${port}`,
  authtoken,
});
const url = listener.url();
if (!url) {
  await listener.close();
  throw new Error("Tunnel did not return a public URL");
}

console.log(`${url.replace(/\/$/, "")}/mcp`);

const close = async () => {
  await listener.close();
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
