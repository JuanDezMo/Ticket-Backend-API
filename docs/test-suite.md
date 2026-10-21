# Suite de pruebas de integración con la pasarela real

Verifica que `ticket-api` se integra correctamente con el microservicio **real** `payment-gateway` (no con simulaciones).
Es independiente de la suite automática (`pnpm test`, 457 pruebas con MSW y PostgreSQL de Testcontainers), que no necesita la pasarela.

- **Script:** `scripts/verify-gateway.sh`
- **Casos:** 17 grupos (GW-00 a GW-17), 48 comprobaciones.
- **Contrato de referencia:** `payment-gateway-microservice-project/docs/openapi.json` y la sección 8 de `docs/business-rules.md`.

## 1. Cómo ejecutarla (en este orden)

Requisitos: Docker con Docker Compose, `bash`, `curl` y `node`.

### 1.1 Levantar primero la pasarela de pagos

```bash
cd /home/juandezmo/Documents/payment-gateway-microservice-project
cp .env.example .env                      # solo la primera vez; si ya existe .env, omitir
docker compose up -d --build
docker compose ps                         # esperar a que postgres y payment-gateway estén "healthy"
curl localhost:8080/actuator/health       # {"status":"UP"}
```

### 1.2 Levantar después ticket-api

```bash
cd /home/juandezmo/Documents/ticket_backend_api
cp .env.example .env                      # solo la primera vez; si ya existe .env, omitir
docker compose up -d --build
docker compose ps                         # esperar a que postgres y ticket-api estén "healthy"
curl localhost:3000/health                # {"status":"UP"}
```

### 1.3 Comprobar que las keys coinciden (sin mostrar los valores)

`PAYMENT_GATEWAY_API_KEY` debe ser idéntica en los dos `.env`:

```bash
cd /home/juandezmo/Documents/ticket_backend_api
a=$(grep '^PAYMENT_GATEWAY_API_KEY=' .env | cut -d= -f2-)
b=$(grep '^PAYMENT_GATEWAY_API_KEY=' ../payment-gateway-microservice-project/.env | cut -d= -f2-)
[ "$a" = "$b" ] && echo COINCIDEN || echo DIFERENTES
```

Si salen `DIFERENTES`, copia la de la pasarela al `.env` de `ticket-api` y recrea el contenedor (un `restart` no relee el `.env`):

```bash
KEY=$(grep '^PAYMENT_GATEWAY_API_KEY=' ../payment-gateway-microservice-project/.env | cut -d= -f2-)
sed -i "s|^PAYMENT_GATEWAY_API_KEY=.*|PAYMENT_GATEWAY_API_KEY=${KEY}|" .env
docker compose up -d
```

Además, `PAYMENT_GATEWAY_URL` en el `.env` de `ticket-api` debe ser `http://host.docker.internal:8080` (con `ticket-api` en Docker) o `http://localhost:8080` (en local).

### 1.4 Ejecutar el script

```bash
cd /home/juandezmo/Documents/ticket_backend_api
./scripts/verify-gateway.sh
```

Termina con código `0` si todo pasa, `1` si algún caso falla y `2` si faltan prerrequisitos (un servicio caído o credenciales de ADMIN inválidas).

### 1.5 Apagar todo (opcional)

```bash
cd /home/juandezmo/Documents/ticket_backend_api && docker compose down
cd /home/juandezmo/Documents/payment-gateway-microservice-project && docker compose down     # con -v borra también su BD
```

## 2. Variables del script

Todas son opcionales; entre paréntesis, el valor por defecto.

| Variable | Descripción |
|---|---|
| `TICKET_API_URL` (`http://localhost:3000`) | URL de `ticket-api` |
| `GATEWAY_URL` (`http://localhost:8080`) | URL de la pasarela (solo para el chequeo de salud y de la key) |
| `TICKET_API_DIR` (este repositorio) | Donde están el `.env` y el `docker-compose.yml` de `ticket-api` |
| `GATEWAY_DIR` (`../payment-gateway-microservice-project`) | Donde está el `docker-compose.yml` de la pasarela |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Credenciales del ADMIN; si no se definen, se leen del `.env` de `ticket-api` |
| `WITH_TEMP_INSTANCES` (`1`) | `0` omite GW-16 y GW-17, que levantan contenedores temporales de `ticket-api` |
| `WITH_GATEWAY_DB` (`1`) | `0` omite las comprobaciones sobre la BD de la pasarela |

Ejemplo, solo contra servicios ya levantados y sin tocar Docker:

```bash
WITH_TEMP_INSTANCES=0 WITH_GATEWAY_DB=0 ./scripts/verify-gateway.sh
```

## 3. Cómo trabaja el script

1. Verifica que ambos servicios respondan `UP` y que la pasarela exija API key.
2. Inicia sesión como ADMIN y crea un **evento nuevo** de 20 puestos (precio 75000) con fecha dentro de un año, de modo que se puede ejecutar muchas veces.
3. Cada caso registra un usuario nuevo, reserva un seat propio y prueba el pago con una tarjeta concreta.
4. Comprueba el código HTTP, el `code` de la respuesta, el estado del seat (`GET /events/:id/seats`), los tickets (`GET /tickets/me`) y, si Docker está disponible, los intentos guardados en la BD de la pasarela (solo lectura).

## 4. Catálogo de casos

Tarjetas de la pasarela: termina en `0000` → rechazada; termina en `9999` → error simulado (el tercer intento con la misma tarjeta y reserva devuelve `CARD_FLAGGED`); cualquier otra → aprobada.

| ID | Caso | Entrada | Resultado esperado |
|---|---|---|---|
| GW-00 | Prerrequisitos | `GET /health`, `GET /actuator/health`, `POST /payments` sin header | Ambos `UP`; la pasarela responde `401` sin key |
| GW-01 | Tarjeta aprobada | VISA `4111111111111111` | `201`, ticket `ISSUED`, monto = precio del evento (75000), seat `SOLD`, 1 ticket en `/tickets/me`, la pasarela guarda 1 intento `APPROVED` |
| GW-02 | Idempotencia | Repetir la misma compra | `200`, mismo ticket y mismo `transactionId`; la pasarela no registra un segundo cobro |
| GW-03 | Tarjeta rechazada | `...0000` | `402` `PAYMENT_REJECTED`; seat sigue `RESERVED`; la pasarela guarda `REJECTED` |
| GW-04 | Error simulado, 3 intentos | `...9999` ×3, misma reserva | `502` `PAYMENT_GATEWAY_ERROR`, `502`, `422` `CARD_PROBLEM`; seat sigue `RESERVED`; la pasarela guarda `ERROR`, `ERROR`, `CARD_FLAGGED` |
| GW-05 | Cambio de tarjeta tras `CARD_FLAGGED` | `...1111` en la misma reserva | `201`, seat `SOLD` |
| GW-06 | `brand` ausente | Sin el campo | `400` `CARD_BRAND_REQUIRED`, mensaje "Card brand is required. Use VISA, MASTERCARD or AMEX" |
| GW-07 | `brand` nulo | `"brand": null` | `400` `CARD_BRAND_REQUIRED` |
| GW-08 | `brand` vacío | `"brand": ""` | `400` `CARD_BRAND_REQUIRED` |
| GW-09 | `brand` en blanco | `"brand": "  "` | `400` `CARD_BRAND_REQUIRED` |
| GW-10 | `brand` no permitido | `DINERS` | `400` `CARD_BRAND_NOT_ALLOWED`, mensaje "Card brand not allowed. Use VISA, MASTERCARD or AMEX"; seat sigue `RESERVED`; **la pasarela no recibe llamadas** |
| GW-11 | `brand` en minúscula | `visa` | `201` (se acepta y se envía como `VISA`) |
| GW-12 | Vencimiento inválido | `expiry` `13/99` | `400` `VALIDATION_ERROR` |
| GW-13 | Tarjeta vencida | `expiry` `01/20` | `400` `VALIDATION_ERROR` |
| GW-14 | Número inválido | `number` `abc` | `400` `VALIDATION_ERROR`; seat sigue `RESERVED`; la pasarela **no guarda** intentos con formato inválido |
| GW-15 | Número sin Luhn válido | `4111111111111234` | `201` (no se valida Luhn) |
| GW-16 | API key incorrecta en `ticket-api` | Instancia temporal en `:3101` con una key errónea | `500` `INTERNAL_ERROR` con mensaje genérico; el log registra el incidente **sin** la key; seat sigue `RESERVED` |
| GW-17 | Timeout | Instancia temporal en `:3102` con `PAYMENT_GATEWAY_TIMEOUT_MS=1`, y luego reintento normal | `504` `PAYMENT_GATEWAY_TIMEOUT`, seat `RESERVED`; el reintento con el timeout normal responde `201` y seat `SOLD` |

En todos los pagos no aprobados (GW-03, 04, 06 a 10, 12 a 14, 16 y 17a) se comprueba también que la reserva sigue activa (seat `RESERVED`) y que no se emitió ticket.

## 5. Resultado de la última ejecución

| Fecha | Pasaron | Fallaron | Omitidos |
|---|---|---|---|
| 2026-10-20 | 48 | 0 | 0 |

## 6. Datos que deja cada ejecución

- Un evento `Suite pasarela real <fecha>` en `ticket-api`.
- Un usuario `suite-<timestamp>-<n>@example.com` por caso, con su reserva, pagos y tickets.
- Intentos de pago en la BD de la pasarela.

Para empezar desde cero: `docker compose down -v` en cada proyecto.

## 7. Qué no cubre

- La pasarela **cobrando y respondiendo después de que `ticket-api` ya canceló la llamada por timeout**: con el timeout de 1 ms la solicitud se cancela antes de llegar a la pasarela, y no se puede lentificar la pasarela real sin modificarla. Ese escenario está cubierto con MSW en la suite automática, y la idempotencia real de la pasarela se valida en GW-02.
- Cancelación de eventos con tickets vendidos y compras en vuelo: están en la suite automática (no dependen de la respuesta de la pasarela).
- Carga y rendimiento.

## 8. Diagnóstico rápido de fallos

| Síntoma | Causa probable |
|---|---|
| Sale con código `2` y "no responde" | Servicio caído o URL incorrecta (`TICKET_API_URL`, `GATEWAY_URL`) |
| GW-01 devuelve `500` `INTERNAL_ERROR` | Las `PAYMENT_GATEWAY_API_KEY` de ambos `.env` no coinciden (ver 1.3) |
| GW-01 devuelve `502` `PAYMENT_GATEWAY_ERROR` | La pasarela no es alcanzable desde `ticket-api` (revisar `PAYMENT_GATEWAY_URL`) |
| Fallan solo las comprobaciones de BD (`GW-01f`, `03d`, `04e`...) | El contenedor `postgres` de la pasarela no está levantado, o `GATEWAY_DIR` es incorrecto |
| Falla solo GW-16 o GW-17 | No se pudo crear la instancia temporal (puertos `3101`/`3102` ocupados, o `docker compose` no disponible); usar `WITH_TEMP_INSTANCES=0` para omitirlos |
