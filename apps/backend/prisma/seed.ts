import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Dev seed users with a shared, well-known password so `POST /auth/login` works
 * out of the box locally. Idempotent so it can be re-run safely.
 */
const DEV_PASSWORD = 'password123';

const users = [
  { email: 'alice@example.com', displayName: 'Alice' },
  { email: 'bob@example.com', displayName: 'Bob' },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { displayName: user.displayName, passwordHash },
      create: { ...user, passwordHash },
    });
  }
  console.log(
    `Seeded ${users.length} dev users (password: "${DEV_PASSWORD}").`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
