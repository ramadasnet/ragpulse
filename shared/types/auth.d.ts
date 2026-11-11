import type { Role } from './index'

declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    avatar?: string
    role: Role
  }
}

export {}
