import type {Role} from "./index"

declare module "#auth-utils" {
    interface SecureSessionData {
        lastActiveAt?: number
        /** Random id of this sign-in, revoked on logout so a late renewal cannot revive it */
        sessionId?: string
    }

    interface User {
        id: string
        email: string
        name: string
        avatar?: string
        role: Role
    }
}

export {}
