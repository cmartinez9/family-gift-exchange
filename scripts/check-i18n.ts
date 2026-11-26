import en from "../messages/en.json" with {type: "json"};
import es from "../messages/es.json" with {type: "json"};
import {missingMessageKeys} from "./message-keys";

const missing = missingMessageKeys({en, es});

if (missing.length > 0) {
  console.error("Missing translation keys\n" + missing.join("\n"));
  process.exitCode = 1;
}
