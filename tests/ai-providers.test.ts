import {expect, test} from "bun:test"
import {splitModelId} from "../shared/utils/ai-providers"

// A misrouted model id breaks every chat answer of the projects using it
test("splitModelId routes prefixed ids and leaves legacy ids without a provider", () => {
    expect(splitModelId("openai:gpt-5-mini")).toEqual({provider: "openai", model: "gpt-5-mini"})
    expect(splitModelId("opencode-go:glm-5.3")).toEqual({provider: "opencode-go", model: "glm-5.3"})
    expect(splitModelId("openrouter:meta-llama/llama-3.1-8b-instruct:free")).toEqual({provider: "openrouter", model: "meta-llama/llama-3.1-8b-instruct:free"})
    // Saved before multiple providers: OpenRouter ids also start with vendor names like openai/
    expect(splitModelId("openai/text-embedding-3-small")).toEqual({model: "openai/text-embedding-3-small"})
    expect(splitModelId("meta-llama/llama-3.1-8b-instruct:free")).toEqual({model: "meta-llama/llama-3.1-8b-instruct:free"})
    expect(splitModelId("llama3:8b")).toEqual({model: "llama3:8b"})
})
