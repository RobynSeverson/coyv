import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import { AdminUserModel, hashPassword } from '../models/AdminUser.ts'

/* Creates or re-passwords the admin account. There is deliberately no
   self-service signup: the only way to get an admin is to run this. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
    },
  })

  const email = (values.email ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase()
  if (!email) throw new Error('Pass --email you@example.com (or set ADMIN_EMAIL)')

  /* A generated password beats a weak chosen one, and it is printed once. */
  const generated = !values.password && !process.env.ADMIN_PASSWORD
  const password = values.password ?? process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url')

  if (password.length < 12) throw new Error('Password must be at least 12 characters')

  await connectToDatabase()

  const passwordHash = await hashPassword(password)
  const existing = await AdminUserModel.findOne({ email }).exec()

  if (existing) {
    existing.set({ passwordHash, ...(values.name ? { displayName: values.name } : {}) })
    await existing.save()
    console.log(`Updated admin ${email}`)
  } else {
    await AdminUserModel.create({ email, passwordHash, displayName: values.name ?? '' })
    console.log(`Created admin ${email}`)
  }

  if (generated) console.log(`Generated password (shown once): ${password}`)

  await disconnectFromDatabase()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
