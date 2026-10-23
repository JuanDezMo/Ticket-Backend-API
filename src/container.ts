import type { Env } from './config/env.js';
import type { Db } from './db/database.js';
import type { Logger } from './shared/logger.js';
import { authenticate } from './shared/middleware/authenticate.js';
import { Argon2PasswordHasher, type PasswordHasher } from './shared/security/password-hasher.js';
import { JwtTokenService, type TokenService } from './shared/security/token-service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { HealthService } from './modules/health/health.service.js';
import { AdminSeeder } from './modules/users/admin-seeder.js';
import { UserController } from './modules/users/user.controller.js';
import { KyselyUserRepository } from './modules/users/user.repository.js';
import { UserService } from './modules/users/user.service.js';
import { EventController } from './modules/events/event.controller.js';
import { KyselyEventRepository } from './modules/events/event.repository.js';
import { EventService } from './modules/events/event.service.js';
import { SeatController } from './modules/seats/seat.controller.js';
import { KyselySeatRepository } from './modules/seats/seat.repository.js';
import { SeatService } from './modules/seats/seat.service.js';
import { CancellationController } from './modules/cancellations/cancellation.controller.js';
import { CancellationService } from './modules/cancellations/cancellation.service.js';
import { BlockSeatsStep } from './modules/cancellations/steps/block-seats.step.js';
import { CancelReservationsStep } from './modules/cancellations/steps/cancel-reservations.step.js';
import { CancelTicketsStep } from './modules/cancellations/steps/cancel-tickets.step.js';
import { HttpPaymentGateway } from './modules/payments/http-payment-gateway.js';
import type { PaymentGateway } from './modules/payments/payment-gateway.js';
import { KyselyPaymentRepository } from './modules/payments/payment.repository.js';
import { PaymentService } from './modules/payments/payment.service.js';
import { TicketController } from './modules/tickets/ticket.controller.js';
import { KyselyTicketRepository } from './modules/tickets/ticket.repository.js';
import { TicketService } from './modules/tickets/ticket.service.js';
import { ReservationController } from './modules/reservations/reservation.controller.js';
import { ReservationExpiryJob } from './modules/reservations/reservation-expiry.job.js';
import { KyselyReservationRepository } from './modules/reservations/reservation.repository.js';
import { ReservationService } from './modules/reservations/reservation.service.js';

export interface ContainerOverrides {
  hasher?: PasswordHasher;
  tokens?: TokenService;
  gateway?: PaymentGateway;
}

/** Raíz de composición: único lugar donde se crean y conectan las instancias. */
export function buildContainer(
  env: Env,
  db: Db,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const hasher = overrides.hasher ?? new Argon2PasswordHasher();
  const tokens =
    overrides.tokens ?? new JwtTokenService(env.JWT_SECRET, env.JWT_EXPIRES_IN_SECONDS);

  const userService = new UserService(new KyselyUserRepository(db), hasher);
  const authService = new AuthService(userService, hasher, tokens);
  const seatService = new SeatService(new KyselySeatRepository(db));
  const eventService = new EventService(new KyselyEventRepository(db), seatService, db);
  const reservationService = new ReservationService(
    new KyselyReservationRepository(db),
    seatService,
    eventService,
    db,
    env.RESERVATION_TTL_MINUTES,
    env.MAX_ACTIVE_HOLDS_PER_USER,
  );

  const gateway =
    overrides.gateway ??
    new HttpPaymentGateway(
      env.PAYMENT_GATEWAY_URL,
      env.PAYMENT_GATEWAY_API_KEY,
      env.PAYMENT_GATEWAY_TIMEOUT_MS,
      logger,
    );
  const paymentService = new PaymentService(gateway, new KyselyPaymentRepository(db), logger);
  const ticketService = new TicketService(
    new KyselyTicketRepository(db),
    reservationService,
    eventService,
    seatService,
    paymentService,
    db,
    logger,
  );

  // IMPORTANTE: el orden de los pasos evita que una reserva simultánea quede ACTIVE sobre un
  // evento cancelado. Primero se bloquean los seats, luego se cancelan las reservas y por último
  // los tickets (con sus pagos a REFUND_PENDING).
  const cancellationService = new CancellationService(
    eventService,
    [
      new BlockSeatsStep(seatService),
      new CancelReservationsStep(reservationService),
      new CancelTicketsStep(ticketService),
    ],
    db,
  );

  return {
    logger,
    authenticate: authenticate(tokens),
    authController: new AuthController(authService),
    userController: new UserController(userService),
    eventController: new EventController(eventService),
    seatController: new SeatController(seatService, eventService, reservationService),
    reservationController: new ReservationController(reservationService),
    reservationExpiryJob: new ReservationExpiryJob(
      reservationService,
      logger,
      env.RESERVATION_EXPIRY_INTERVAL_SECONDS,
    ),
    reservationService,
    ticketController: new TicketController(ticketService),
    cancellationController: new CancellationController(cancellationService),
    healthController: new HealthController(new HealthService(db)),
    adminSeeder: new AdminSeeder(
      userService,
      { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD },
      logger,
    ),
  };
}

export type Container = ReturnType<typeof buildContainer>;
