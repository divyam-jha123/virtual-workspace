import { UnauthorizedException } from '@nestjs/common';
import { LoginCode } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { EmailCodeService } from './email-code.service';
import { TooManyCodeRequestsException } from './too-many-code-requests.exception';

const EMAIL = 'alice@example.com';

describe('EmailCodeService', () => {
  function makeService() {
    const loginCode = {
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    };
    const prisma = { loginCode };
    const mailer = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new EmailCodeService(
      prisma as unknown as PrismaService,
      mailer as unknown as Mailer,
    );
    return { service, loginCode, mailer };
  }

  /** A live code row whose hash matches `code`. */
  async function codeRow(code: string, overrides: Partial<LoginCode> = {}) {
    return {
      id: 'code_1',
      email: EMAIL,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      attempts: 0,
      createdAt: new Date(),
      ...overrides,
    } satisfies LoginCode;
  }

  /** Pull the code out of the sent email, which is the only place it exists. */
  function sentCode(mailer: { send: jest.Mock }): string {
    const { text } = mailer.send.mock.calls[0][0];
    return /\b(\d{6})\b/.exec(text)![1];
  }

  describe('requestCode', () => {
    it('emails a 6-digit code and stores only its hash', async () => {
      const { service, loginCode, mailer } = makeService();

      await service.requestCode(EMAIL);

      const code = sentCode(mailer);
      expect(code).toMatch(/^\d{6}$/);

      const { data } = loginCode.create.mock.calls[0][0];
      expect(data.codeHash).not.toContain(code);
      await expect(bcrypt.compare(code, data.codeHash)).resolves.toBe(true);
    });

    it('normalises the address so one person gets one account', async () => {
      const { service, loginCode, mailer } = makeService();

      await service.requestCode('  Alice@Example.COM ');

      expect(loginCode.create.mock.calls[0][0].data.email).toBe(EMAIL);
      expect(mailer.send.mock.calls[0][0].to).toBe(EMAIL);
    });

    it('retires the previous code, so a resend leaves exactly one live', async () => {
      const { service, loginCode } = makeService();

      await service.requestCode(EMAIL);

      expect(loginCode.updateMany).toHaveBeenCalledWith({
        where: { email: EMAIL, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('rejects a 4th request in the window without sending', async () => {
      const { service, loginCode, mailer } = makeService();
      loginCode.count.mockResolvedValue(3);

      await expect(service.requestCode(EMAIL)).rejects.toBeInstanceOf(
        TooManyCodeRequestsException,
      );
      expect(mailer.send).not.toHaveBeenCalled();
      expect(loginCode.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyCode', () => {
    it('consumes the code when it matches', async () => {
      const { service, loginCode } = makeService();
      loginCode.findFirst.mockResolvedValue(await codeRow('123456'));

      await expect(service.verifyCode(EMAIL, '123456')).resolves.toBeUndefined();

      expect(loginCode.update).toHaveBeenCalledWith({
        where: { id: 'code_1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('only ever considers a live code — never expired or consumed', async () => {
      const { service, loginCode } = makeService();
      loginCode.findFirst.mockResolvedValue(await codeRow('123456'));

      await service.verifyCode(EMAIL, '123456');

      // The query itself is the guard for expiry and reuse, so assert on it.
      expect(loginCode.findFirst).toHaveBeenCalledWith({
        where: {
          email: EMAIL,
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('counts the attempt and throws 401 on a wrong code', async () => {
      const { service, loginCode } = makeService();
      loginCode.findFirst.mockResolvedValue(await codeRow('123456'));

      await expect(service.verifyCode(EMAIL, '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(loginCode.update).toHaveBeenCalledWith({
        where: { id: 'code_1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('rejects a 6th guess even when it is the right code, and burns it', async () => {
      const { service, loginCode } = makeService();
      loginCode.findFirst.mockResolvedValue(await codeRow('123456', { attempts: 5 }));

      await expect(service.verifyCode(EMAIL, '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // Left live, a guesser could keep going by ignoring the counter.
      expect(loginCode.update).toHaveBeenCalledWith({
        where: { id: 'code_1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('throws 401 when there is no live code for the address', async () => {
      const { service, loginCode } = makeService();
      loginCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyCode(EMAIL, '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(loginCode.update).not.toHaveBeenCalled();
    });

    it('reports the same message whether the code is wrong or absent', async () => {
      const { service, loginCode } = makeService();

      loginCode.findFirst.mockResolvedValue(null);
      const absent = await service.verifyCode(EMAIL, '123456').catch((e) => e);

      loginCode.findFirst.mockResolvedValue(await codeRow('123456'));
      const wrong = await service.verifyCode(EMAIL, '000000').catch((e) => e);

      // Any difference here tells someone guessing at an address which of the
      // two they hit, which is exactly what they want to know.
      expect(absent.message).toBe(wrong.message);
    });

    it('verifies a code requested under a differently-cased address', async () => {
      const { service, loginCode, mailer } = makeService();
      await service.requestCode('Alice@Example.COM');
      const code = sentCode(mailer);
      loginCode.findFirst.mockResolvedValue(await codeRow(code));

      await expect(service.verifyCode('ALICE@example.com', code)).resolves
        .toBeUndefined();
    });
  });
});
