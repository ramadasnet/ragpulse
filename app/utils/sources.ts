import {GitBranch, Globe, HardDrive} from "lucide-vue-next"
import type {SourceType} from "#shared/types"

/** Source types with their label and icon */
export const SOURCE_TYPES: Array<{id: SourceType; label: string; icon: typeof Globe}> = [
    {id: "url", label: "Website URL", icon: Globe},
    {id: "git", label: "Git repository", icon: GitBranch},
    {id: "drive", label: "Google Drive", icon: HardDrive}
]

export function sourceTypeInfo(type: SourceType) {
    return SOURCE_TYPES.find((t) => t.id === type) ?? SOURCE_TYPES[0]!
}
