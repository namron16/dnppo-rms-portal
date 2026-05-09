
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface AccountSeed {
  email:        string
  password:     string
  role:         string
  display_name: string
  title:        string
  initials:     string
  avatar_color: string
}

// ─── Define all 13 accounts here ──────────────────────────
// Use strong, unique passwords. Store these in a password manager.
// After seeding, each user should change their password via
// the profile settings page (implement a change-password flow).

const ACCOUNTS: AccountSeed[] = [
  {
    email:        'superadmin@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_1!',
    role:         'admin',
    display_name: 'Super Admin',
    title:        'Super Administrator',
    initials:     'SA',
    avatar_color: '#dc2626',
  },
  {
    email:        'pd@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_2!',
    role:         'PD',
    display_name: 'Provincial Director',
    title:        'Provincial Director',
    initials:     'PD',
    avatar_color: '#1d4ed8',
  },
  {
    email:        'dpda@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_3!',
    role:         'DPDA',
    display_name: 'Deputy Director for Administration',
    title:        'Deputy Director for Administration',
    initials:     'DPDA',
    avatar_color: '#0d9488',
  },
  {
    email:        'dpdo@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_4!',
    role:         'DPDO',
    display_name: 'Deputy Director for Operations',
    title:        'Deputy Director for Operations',
    initials:     'DPDO',
    avatar_color: '#16a34a',
  },
  {
    email:        'p1@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_5!',
    role:         'P1',
    display_name: 'Records Officer — P1',
    title:        'Records Officer',
    initials:     'P1',
    avatar_color: '#7c3aed',
  },
  {
    email:        'p2@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_6!',
    role:         'P2',
    display_name: 'Admin Officer — P2',
    title:        'Admin Officer P2',
    initials:     'P2',
    avatar_color: '#0891b2',
  },
  {
    email:        'p3@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_7!',
    role:         'P3',
    display_name: 'Admin Officer — P3',
    title:        'Admin Officer P3',
    initials:     'P3',
    avatar_color: '#0d9488',
  },
  {
    email:        'p4@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_8!',
    role:         'P4',
    display_name: 'Admin Officer — P4',
    title:        'Admin Officer P4',
    initials:     'P4',
    avatar_color: '#16a34a',
  },
  {
    email:        'p5@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_9!',
    role:         'P5',
    display_name: 'Admin Officer — P5',
    title:        'Admin Officer P5',
    initials:     'P5',
    avatar_color: '#ca8a04',
  },
  {
    email:        'p6@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_10!',
    role:         'P6',
    display_name: 'Admin Officer — P6',
    title:        'Admin Officer P6',
    initials:     'P6',
    avatar_color: '#ea580c',
  },
  {
    email:        'p7@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_11!',
    role:         'P7',
    display_name: 'Admin Officer — P7',
    title:        'Admin Officer P7',
    initials:     'P7',
    avatar_color: '#e11d48',
  },
  {
    email:        'p8@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_12!',
    role:         'P8',
    display_name: 'Admin Officer — P8',
    title:        'Admin Officer P8',
    initials:     'P8',
    avatar_color: '#8b5cf6',
  },
  {
    email:        'p9@dnppo.gov.ph',
    password:     'CHANGE_ME_strong_password_13!',
    role:         'P9',
    display_name: 'Admin Officer — P9',
    title:        'Admin Officer P9',
    initials:     'P9',
    avatar_color: '#06b6d4',
  },
  // Note: original code had 13 accounts (admin + PD + DPDA + DPDO + P1–P9).
  // Add P10 here if needed:
  // {
  //   email:        'p10@dnppo.gov.ph',
  //   password:     'CHANGE_ME_strong_password_14!',
  //   role:         'P10',
  //   display_name: 'Admin Officer — P10',
  //   title:        'Admin Officer P10',
  //   initials:     'P10',
  //   avatar_color: '#10b981',
  // },
]

async function seedAdmins() {
  console.log('Starting admin account seed...\n')

  for (const account of ACCOUNTS) {
    console.log(`Creating: ${account.email} (${account.role})`)

    // 1. Create the auth user
    const { data: authData, error: authError } =
      await admin.auth.admin.createUser({
        email:          account.email,
        password:       account.password,
        email_confirm:  true,   // pre-confirmed — no email needed for setup
        user_metadata:  { role: account.role },
      })

    if (authError) {
      console.error(`  ✗ Auth error for ${account.email}:`, authError.message)
      continue
    }

    const userId = authData.user.id
    console.log(`  ✓ Auth user created: ${userId}`)

    // 2. Insert the profile row
    const { error: profileError } = await admin
      .from('profiles')
      .insert({
        id:           userId,
        role:         account.role,
        display_name: account.display_name,
        title:        account.title,
        initials:     account.initials,
        avatar_color: account.avatar_color,
      })

    if (profileError) {
      console.error(`  ✗ Profile error for ${account.email}:`, profileError.message)
    } else {
      console.log(`  ✓ Profile inserted`)
    }

    console.log('')
  }

  console.log('Seed complete.')
}

seedAdmins().catch(console.error)