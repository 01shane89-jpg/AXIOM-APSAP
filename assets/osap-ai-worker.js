/* AXIOM OSAP: the worker that runs OSAP's own AI model (assets/osap-ai.js), so loading and writing never freeze the page.
   WebLLM 0.2.85 (Apache-2.0, assets/vendor/web-llm-LICENSE.txt) is kept in this repository; the model's weights download from
   Hugging Face (mlc-ai) once and stay in this browser's storage. */
import { WebWorkerMLCEngineHandler } from "./vendor/web-llm-0.2.85.js";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => { handler.onmessage(msg); };
