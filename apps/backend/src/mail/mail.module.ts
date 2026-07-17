import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleMailer } from './console.mailer';
import { Mailer, MAILER } from './mailer';
import { ResendMailer } from './resend.mailer';

/**
 * Provides the app's single `Mailer`, chosen at boot from the environment:
 * Resend when RESEND_API_KEY is set, otherwise the console mailer so local dev
 * needs no provider account.
 */
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Mailer => {
        const apiKey = config.get<string>('RESEND_API_KEY');
        const log = new Logger('MailModule');

        if (!apiKey) {
          // The console mailer writes login codes to stdout. That's a handy dev
          // default and a credential leak in production, so refuse to boot
          // rather than quietly log codes on a real deployment.
          if (config.get<string>('NODE_ENV') === 'production') {
            throw new Error(
              'RESEND_API_KEY is required in production: without it the backend ' +
                'would log one-time login codes to stdout instead of emailing them.',
            );
          }
          log.warn('RESEND_API_KEY unset — login codes will be logged, not emailed.');
          return new ConsoleMailer();
        }

        // ConfigModule fails at boot if MAIL_FROM is missing, so it is set here.
        return new ResendMailer(apiKey, config.get<string>('MAIL_FROM')!);
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
