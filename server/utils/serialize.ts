import type {Source, SourceView} from "#shared/types"
import {parseServiceAccountKey} from "./ingest/drive"

/** Strips secrets from a source before sending it to clients. */
export function serializeSource(source: Source): SourceView {
    const {accessToken, serviceAccountKey, ...options} = source.options || {}
    let serviceAccountEmail: string | undefined
    try {
        serviceAccountEmail = serviceAccountKey ? parseServiceAccountKey(serviceAccountKey).client_email : undefined
    } catch {}
    return {...source, options: {...options, hasAccessToken: !!accessToken, hasServiceAccountKey: !!serviceAccountKey, ...(serviceAccountEmail ? {serviceAccountEmail} : {})}}
}
