import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Dev seed users. `passwordHash` is a placeholder here — real password hashing
 * (bcrypt) arrives with the JWT auth PR (#24); this issue only introduces the
 * User model. Idempotent so it can be re-run safely.
 */
const users = [
  { email: 'alice@example.com', displayName: 'Alice' },
  { email: 'bob@example.com', displayName: 'Bob' },
];

async function main(): Promise<void> {
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { displayName: user.displayName },
      create: { ...user, passwordHash: 'placeholder-set-in-auth-pr' },
    });
  }
  console.log(`Seeded ${users.length} dev users.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
