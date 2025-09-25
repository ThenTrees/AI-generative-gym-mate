// src/middleware/logger.middleware.ts
import morgan from "morgan";
import chalk from "chalk";

// Custom tokens với màu sắc
morgan.token("timestamp", () => {
  return chalk.gray(new Date().toISOString());
});

morgan.token("colored-method", (req) => {
  const method = req.method;
  switch (method) {
    case "GET":
      return chalk.green(method);
    case "POST":
      return chalk.yellow(method);
    case "PUT":
      return chalk.blue(method);
    case "DELETE":
      return chalk.red(method);
    case "PATCH":
      return chalk.magenta(method);
    default:
      return chalk.white(method);
  }
});

morgan.token("colored-status", (req, res) => {
  const status = res.statusCode;
  if (status >= 500) return chalk.red(status);
  if (status >= 400) return chalk.yellow(status);
  if (status >= 300) return chalk.cyan(status);
  if (status >= 200) return chalk.green(status);
  return chalk.white(status);
});

morgan.token("colored-url", (req) => {
  return chalk.cyan(req.url);
});

// Format với màu sắc
export const coloredLogger = morgan(
  ":timestamp :colored-method :colored-url :colored-status :res[content-length] - :response-time ms"
);

export const detailedColoredLogger = morgan(
  chalk.gray("[") +
    ":timestamp" +
    chalk.gray("]") +
    chalk.white(" INCOMING_REQUEST: ") +
    chalk.white("method=") +
    ":colored-method" +
    chalk.white(", uri=") +
    ":colored-url" +
    chalk.white(", status=") +
    ":colored-status" +
    chalk.white(", response-time=") +
    chalk.magenta(":response-time ms") +
    chalk.white(", content-length=") +
    chalk.cyan(":res[content-length]")
);
