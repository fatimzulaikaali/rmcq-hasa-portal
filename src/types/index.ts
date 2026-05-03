export type UserRole = 'admin' | 'manager' | 'staff'

export interface AppUser {
  id: string
  email: string
  role?: UserRole
}
