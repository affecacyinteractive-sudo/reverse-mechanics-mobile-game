import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

export function getModel() {
    const provider = process.env.RM_PROVIDER ?? "google";
    const model = process.env.RM_MODEL ?? "gemini-2.5-flash";

    if (provider === "openai") {
        // Example fallback model; change as needed
        return openai(model);
    }

    return google(model);
}
