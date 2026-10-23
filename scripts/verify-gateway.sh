#!/usr/bin/env bash
# Verificación de integración de ticket-api contra la pasarela de pagos REAL.
# Ejecuta los casos de docs/test-suite.md. Requiere: bash, curl, node (y, opcionalmente, docker).
#
# Uso:   ./scripts/verify-gateway.sh
# Variables opcionales (con su valor por defecto):
#   TICKET_API_URL=http://localhost:3000     GATEWAY_URL=http://localhost:8080
#   TICKET_API_DIR=<este repositorio>        GATEWAY_DIR=../payment-gateway-microservice-project
#   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD   (si no se definen, se leen del .env de ticket-api)
#   WITH_TEMP_INSTANCES=1|0                  casos GW-16 y GW-17 (levantan contenedores temporales)
#   WITH_GATEWAY_DB=1|0                      comprobaciones en la BD de la pasarela (usa docker)
# Código de salida: 0 si todo pasa, 1 si algún caso falla, 2 si faltan prerrequisitos.

set -u

TICKET_API_DIR="${TICKET_API_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GATEWAY_DIR="${GATEWAY_DIR:-$TICKET_API_DIR/../payment-gateway-microservice-project}"
API="${TICKET_API_URL:-http://localhost:3000}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
WITH_TEMP_INSTANCES="${WITH_TEMP_INSTANCES:-1}"
WITH_GATEWAY_DB="${WITH_GATEWAY_DB:-1}"
J='Content-Type: application/json'

# ---------- configuración desde el .env de ticket-api (sin mostrar valores) ----------
if [ -f "$TICKET_API_DIR/.env" ]; then
  set -a; . "$TICKET_API_DIR/.env"; set +a
fi
: "${SEED_ADMIN_EMAIL:?Define SEED_ADMIN_EMAIL (o créalo en el .env de ticket-api)}"
: "${SEED_ADMIN_PASSWORD:?Define SEED_ADMIN_PASSWORD (o créalo en el .env de ticket-api)}"

PASS=0; FAIL=0; SKIP=0
FAILED_CASES=()

# ---------- utilidades ----------
field() { node -pe "JSON.parse(require('fs').readFileSync(0)).$1"; }
json_get() { node -e "const j=JSON.parse(process.argv[1]);const v=process.argv[2].split('.').reduce((a,k)=>a==null?a:a[k],j);console.log(v===undefined?'':v)" "$1" "$2"; }

pass() { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); FAILED_CASES+=("$1"); printf '  \033[31mFAIL\033[0m  %s  (%s)\n' "$1" "$2"; }
skip() { SKIP=$((SKIP+1)); printf '  \033[33mSKIP\033[0m  %s  (%s)\n' "$1" "$2"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# check <id> <descripción> <esperado> <actual>
check() {
  if [ "$3" = "$4" ]; then pass "$1  $2"; else fail "$1  $2" "esperado: '$3' | obtenido: '$4'"; fi
}

gw_db_available() {
  [ "$WITH_GATEWAY_DB" = "1" ] && command -v docker >/dev/null 2>&1 && [ -f "$GATEWAY_DIR/docker-compose.yml" ] \
    && docker compose -f "$GATEWAY_DIR/docker-compose.yml" --project-directory "$GATEWAY_DIR" ps -q postgres 2>/dev/null | grep -q .
}
# Intentos que la pasarela guardó para una reserva: "1 ERROR;2 ERROR;3 CARD_FLAGGED;"
gw_attempts() {
  docker compose -f "$GATEWAY_DIR/docker-compose.yml" --project-directory "$GATEWAY_DIR" exec -T postgres sh -c \
    "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"select attempt_number||' '||status from payment_attempts where reservation_id='$1' order by created_at\"" 2>/dev/null \
    | tr '\n' ';'
}

# ---------- helpers de negocio ----------
admin_login() {
  curl -s -X POST "$API/auth/login" -H "$J" \
    -d "{\"email\":\"$SEED_ADMIN_EMAIL\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" | field accessToken
}

# new_reservation <api> <eventId> <seat>  -> define USR, EMAIL y RID
new_reservation() {
  EMAIL="suite-$(date +%s)-$RANDOM@example.com"
  curl -s -o /dev/null -X POST "$1/auth/register" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"password-123\"}"
  USR=$(curl -s -X POST "$1/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"password-123\"}" | field accessToken)
  RID=$(curl -s -X POST "$1/reservations" -H "Authorization: Bearer $USR" -H "$J" \
    -d "{\"eventId\":\"$2\",\"seats\":[\"$3\"]}" | field reservations[0].id)
}

# pay <api> <cardJson>  -> define HTTP, CODE (code o status) y BODY
pay() {
  local out
  out=$(curl -s -w '|%{http_code}' -X POST "$1/tickets/purchase" -H "Authorization: Bearer $USR" -H "$J" \
    -d "{\"reservationIds\":[\"$RID\"],\"card\":$2}")
  HTTP="${out##*|}"; BODY="${out%|*}"
  # Con éxito la respuesta es { orderId, amount, tickets: [...] }: el estado es el del primer ticket
  CODE=$(json_get "$BODY" code); [ -n "$CODE" ] || CODE=$(json_get "$BODY" tickets.0.status)
}

card() { printf '{"brand":"%s","number":"%s","expiry":"%s","cvv":"123"}' "${2-VISA}" "$1" "${3-12/28}"; }

# Estado actual del seat (AVAILABLE | RESERVED | SOLD | BLOCKED) por su etiqueta
seat_status() {
  curl -s "$API/events/$EV/seats" -H "Authorization: Bearer $USR" \
    | node -e "const d=JSON.parse(require('fs').readFileSync(0));const s=d.data.find(x=>x.label==='$1');console.log(s?s.status:'?')"
}
my_tickets() { curl -s "$API/tickets/me" -H "Authorization: Bearer $USR" | field 'meta.total'; }

wait_health() { for _ in $(seq 1 30); do curl -s -m 2 "$1/health" | grep -q UP && return 0; sleep 2; done; return 1; }

# ============================== PRERREQUISITOS ==============================
section "GW-00  Prerrequisitos"
H1=$(curl -s -m 5 "$API/health"); H2=$(curl -s -m 5 "$GATEWAY_URL/actuator/health")
if ! echo "$H1" | grep -q UP; then echo "ticket-api no responde en $API. Levántalo primero (ver docs/test-suite.md)."; exit 2; fi
if ! echo "$H2" | grep -q UP; then echo "La pasarela no responde en $GATEWAY_URL. Levántala primero (ver docs/test-suite.md)."; exit 2; fi
pass "GW-00a  ticket-api y la pasarela responden UP"
check "GW-00b" "la pasarela exige API key (sin header -> 401)" "401" \
  "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "$GATEWAY_URL/payments" -H "$J" -d '{}')"

ADM=$(admin_login)
if [ -z "$ADM" ] || [ "$ADM" = "undefined" ]; then echo "No se pudo iniciar sesión como ADMIN con SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD."; exit 2; fi
START_DATE=$(date -u -d '+1 year' +%Y-%m-%dT20:00:00Z 2>/dev/null || date -u -v+1y +%Y-%m-%dT20:00:00Z)
END_DATE=${START_DATE/T20/T23}
EV=$(curl -s -X POST "$API/events" -H "Authorization: Bearer $ADM" -H "$J" \
  -d "{\"name\":\"Suite pasarela real $(date +%F-%H%M%S)\",\"description\":\"Datos de prueba\",\"type\":\"CONCERT\",\"venue\":\"Hall\",\"price\":75000,\"capacity\":20,\"maxSeatsPerUser\":4,\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\"}" | field id)
[ -n "$EV" ] && [ "$EV" != "undefined" ] || { echo "No se pudo crear el evento de prueba."; exit 2; }
echo "  evento de prueba: $EV"

GWDB=0; gw_db_available && GWDB=1
[ "$GWDB" = "1" ] && echo "  BD de la pasarela accesible: se verificarán los intentos guardados" \
                  || echo "  BD de la pasarela no accesible: se omiten esas comprobaciones"

# ============================== APROBACIÓN E IDEMPOTENCIA ==============================
section "GW-01/02  Tarjeta aprobada e idempotencia"
new_reservation "$API" "$EV" A1
pay "$API" "$(card 4111111111111111)"
check "GW-01a" "compra aprobada -> HTTP 201" "201" "$HTTP"
check "GW-01b" "ticket ISSUED" "ISSUED" "$CODE"
check "GW-01c" "monto = precio del evento" "75000" "$(json_get "$BODY" amount)"
ORDER1=$(json_get "$BODY" orderId); TXN1=$(json_get "$BODY" tickets.0.transactionId)
check "GW-01d" "el seat queda SOLD" "SOLD" "$(seat_status A1)"
check "GW-01e" "GET /tickets/me muestra 1 ticket" "1" "$(my_tickets)"
[ "$GWDB" = "1" ] && check "GW-01f" "la pasarela guardó 1 intento APPROVED" "1 APPROVED;" "$(gw_attempts "$RID")"
pay "$API" "$(card 4111111111111111)"
check "GW-02a" "repetir la compra -> HTTP 409 DUPLICATE_PAYMENT" "409 DUPLICATE_PAYMENT" "$HTTP $CODE"
check "GW-02b" "no se devuelven los tickets ya emitidos" "" "$(json_get "$BODY" orderId)"
check "GW-02c" "el pedido original sigue siendo el único ticket del usuario" "1" "$(my_tickets)"
[ "$GWDB" = "1" ] && check "GW-02d" "sin nuevo cobro (la pasarela sigue con 1 intento)" "1 APPROVED;" "$(gw_attempts "$RID")"

# ============================== RECHAZO Y ERROR SIMULADO ==============================
section "GW-03  Tarjeta rechazada (...0000)"
new_reservation "$API" "$EV" A2
pay "$API" "$(card 4111111111110000)"
check "GW-03a" "HTTP 402" "402" "$HTTP"
check "GW-03b" "código PAYMENT_REJECTED" "PAYMENT_REJECTED" "$CODE"
check "GW-03c" "el seat sigue RESERVED (la reserva sigue activa)" "RESERVED" "$(seat_status A2)"
[ "$GWDB" = "1" ] && check "GW-03d" "la pasarela guardó el intento REJECTED" "1 REJECTED;" "$(gw_attempts "$RID")"

section "GW-04/05  Error simulado (...9999): tres intentos y cambio de tarjeta"
new_reservation "$API" "$EV" A3
pay "$API" "$(card 4111111111119999)"; check "GW-04a" "intento 1 -> 502 PAYMENT_GATEWAY_ERROR" "502 PAYMENT_GATEWAY_ERROR" "$HTTP $CODE"
pay "$API" "$(card 4111111111119999)"; check "GW-04b" "intento 2 -> 502 PAYMENT_GATEWAY_ERROR" "502 PAYMENT_GATEWAY_ERROR" "$HTTP $CODE"
pay "$API" "$(card 4111111111119999)"; check "GW-04c" "intento 3 -> 422 CARD_PROBLEM" "422 CARD_PROBLEM" "$HTTP $CODE"
check "GW-04d" "el seat sigue RESERVED" "RESERVED" "$(seat_status A3)"
[ "$GWDB" = "1" ] && check "GW-04e" "la pasarela guardó ERROR, ERROR, CARD_FLAGGED" "1 ERROR;2 ERROR;3 CARD_FLAGGED;" "$(gw_attempts "$RID")"
pay "$API" "$(card 4111111111111111)"
check "GW-05a" "con otra tarjeta -> 201 ISSUED" "201 ISSUED" "$HTTP $CODE"
check "GW-05b" "el seat queda SOLD" "SOLD" "$(seat_status A3)"

# ============================== FRANQUICIA ==============================
section "GW-06..11  Franquicia (card.brand)"
new_reservation "$API" "$EV" A4
NOBRAND='{"number":"4111111111111111","expiry":"12/28","cvv":"123"}'
pay "$API" "$NOBRAND"
check "GW-06" "brand ausente -> 400 CARD_BRAND_REQUIRED" "400 CARD_BRAND_REQUIRED" "$HTTP $CODE"
check "GW-06m" "mensaje exacto" "Card brand is required. Use VISA, MASTERCARD or AMEX" "$(json_get "$BODY" message)"
pay "$API" '{"brand":null,"number":"4111111111111111","expiry":"12/28","cvv":"123"}'
check "GW-07" "brand null -> 400 CARD_BRAND_REQUIRED" "400 CARD_BRAND_REQUIRED" "$HTTP $CODE"
pay "$API" '{"brand":"","number":"4111111111111111","expiry":"12/28","cvv":"123"}'
check "GW-08" "brand \"\" -> 400 CARD_BRAND_REQUIRED" "400 CARD_BRAND_REQUIRED" "$HTTP $CODE"
pay "$API" '{"brand":"  ","number":"4111111111111111","expiry":"12/28","cvv":"123"}'
check "GW-09" "brand \"  \" -> 400 CARD_BRAND_REQUIRED" "400 CARD_BRAND_REQUIRED" "$HTTP $CODE"
pay "$API" "$(card 4111111111111111 DINERS)"
check "GW-10" "brand DINERS -> 400 CARD_BRAND_NOT_ALLOWED" "400 CARD_BRAND_NOT_ALLOWED" "$HTTP $CODE"
check "GW-10m" "mensaje exacto" "Card brand not allowed. Use VISA, MASTERCARD or AMEX" "$(json_get "$BODY" message)"
check "GW-10s" "ningún error de franquicia tocó el seat (sigue RESERVED)" "RESERVED" "$(seat_status A4)"
[ "$GWDB" = "1" ] && check "GW-10g" "la pasarela no recibió ninguna llamada" "" "$(gw_attempts "$RID")"
pay "$API" "$(card 4111111111111111 visa)"
check "GW-11" "brand visa (minúscula) -> 201 ISSUED" "201 ISSUED" "$HTTP $CODE"

# ============================== DATOS INVÁLIDOS ==============================
section "GW-12..15  Datos de tarjeta (los valida la pasarela)"
new_reservation "$API" "$EV" A5
pay "$API" "$(card 4111111111111111 VISA 13/99)"; check "GW-12" "expiry 13/99 -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
pay "$API" "$(card 4111111111111111 VISA 01/20)"; check "GW-13" "tarjeta vencida -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
pay "$API" "$(card abc)";                          check "GW-14" "número 'abc' -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
check "GW-14s" "el seat sigue RESERVED" "RESERVED" "$(seat_status A5)"
[ "$GWDB" = "1" ] && check "GW-14g" "la pasarela no guarda intentos con formato inválido" "" "$(gw_attempts "$RID")"
pay "$API" "$(card 4111111111111234)"
check "GW-15" "número sin Luhn válido -> 201 ISSUED (no se valida Luhn)" "201 ISSUED" "$HTTP $CODE"

# ============================== INSTANCIAS TEMPORALES ==============================
temp_instance() { # <nombre> <puerto> <VAR=valor>
  ( cd "$TICKET_API_DIR" && docker compose run -d --no-deps --name "$1" -p "$2:3000" -e "$3" ticket-api >/dev/null 2>&1 )
}
remove_instance() { docker rm -f "$1" >/dev/null 2>&1; }

if [ "$WITH_TEMP_INSTANCES" = "1" ] && command -v docker >/dev/null 2>&1; then
  section "GW-16  API key incorrecta en ticket-api (instancia temporal :3101)"
  new_reservation "$API" "$EV" A6; BAD_EMAIL=$EMAIL
  if temp_instance suite-badkey 3101 PAYMENT_GATEWAY_API_KEY=clave-incorrecta && wait_health "http://localhost:3101"; then
    USR=$(curl -s -X POST "http://localhost:3101/auth/login" -H "$J" -d "{\"email\":\"$BAD_EMAIL\",\"password\":\"password-123\"}" | field accessToken)
    pay "http://localhost:3101" "$(card 4111111111111111)"
    check "GW-16a" "key rechazada -> 500 INTERNAL_ERROR genérico" "500 INTERNAL_ERROR" "$HTTP $CODE"
    check "GW-16b" "mensaje genérico (sin detalles)" "Internal server error" "$(json_get "$BODY" message)"
    check "GW-16c" "el log registra el incidente" "1" "$(docker logs suite-badkey 2>&1 | grep -c 'rejected the API key')"
    check "GW-16d" "la key enviada no aparece en los logs" "0" "$(docker logs suite-badkey 2>&1 | grep -c 'clave-incorrecta')"
    USR=$(curl -s -X POST "$API/auth/login" -H "$J" -d "{\"email\":\"$BAD_EMAIL\",\"password\":\"password-123\"}" | field accessToken)
    check "GW-16e" "el seat sigue RESERVED" "RESERVED" "$(seat_status A6)"
  else
    skip "GW-16" "no se pudo levantar la instancia temporal"
  fi
  remove_instance suite-badkey

  section "GW-17  Timeout (instancia temporal :3102 con PAYMENT_GATEWAY_TIMEOUT_MS=1)"
  new_reservation "$API" "$EV" A7; TO_EMAIL=$EMAIL; TO_RID=$RID
  if temp_instance suite-timeout 3102 PAYMENT_GATEWAY_TIMEOUT_MS=1 && wait_health "http://localhost:3102"; then
    USR=$(curl -s -X POST "http://localhost:3102/auth/login" -H "$J" -d "{\"email\":\"$TO_EMAIL\",\"password\":\"password-123\"}" | field accessToken)
    pay "http://localhost:3102" "$(card 4111111111111111)"
    check "GW-17a" "timeout -> 504 PAYMENT_GATEWAY_TIMEOUT" "504 PAYMENT_GATEWAY_TIMEOUT" "$HTTP $CODE"
    USR=$(curl -s -X POST "$API/auth/login" -H "$J" -d "{\"email\":\"$TO_EMAIL\",\"password\":\"password-123\"}" | field accessToken)
    check "GW-17b" "la reserva sigue activa (seat RESERVED)" "RESERVED" "$(seat_status A7)"
    RID=$TO_RID
    pay "$API" "$(card 4111111111111111)"
    check "GW-17c" "nuevo intento inmediato tras el timeout -> 409 PAYMENT_IN_PROGRESS (el reclamo se mantiene)" "409 PAYMENT_IN_PROGRESS" "$HTTP $CODE"
    printf '        (esperando 31 s a que venza el reclamo de pago...)\n'; sleep 31
    pay "$API" "$(card 4111111111111111)"
    check "GW-17e" "nuevo intento pasado el reclamo, con el timeout normal -> 201 ISSUED" "201 ISSUED" "$HTTP $CODE"
    check "GW-17d" "el seat queda SOLD" "SOLD" "$(seat_status A7)"
  else
    skip "GW-17" "no se pudo levantar la instancia temporal"
  fi
  remove_instance suite-timeout
else
  section "GW-16/17  Instancias temporales"
  skip "GW-16" "WITH_TEMP_INSTANCES=0 o docker no disponible"
  skip "GW-17" "WITH_TEMP_INSTANCES=0 o docker no disponible"
fi

# ============================== GW-22..28: compras de varias reservas contra ticket-api y la pasarela REAL ==============================
section "GW-22..28  Compra de un grupo de reservas (group-purchase)"
ADM_TOKEN=$(admin_login)
# new_group <n> -> usuario nuevo con n reservas ACTIVE reservadas en un lote (límite 8). Define USR, GEV, GIDS (JSON) y GSEATS
new_group() {
  local email="suite-group-$(date +%s)-$RANDOM@example.com" n=$1 seats="" i
  curl -s -o /dev/null -X POST "$API/auth/register" -H "$J" -d "{\"email\":\"$email\",\"password\":\"password-123\"}"
  USR=$(curl -s -X POST "$API/auth/login" -H "$J" -d "{\"email\":\"$email\",\"password\":\"password-123\"}" | field accessToken)
  GEV=$(curl -s -X POST "$API/events" -H "Authorization: Bearer $ADM_TOKEN" -H "$J" \
    -d "{\"name\":\"Suite grupo $(date +%F-%H%M%S)-$RANDOM\",\"description\":\"Datos de prueba\",\"type\":\"CONCERT\",\"venue\":\"Hall\",\"price\":75000,\"capacity\":30,\"maxSeatsPerUser\":8,\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\"}" | field id)
  for i in $(seq 1 "$n"); do seats="$seats\"A$i\","; done
  GSEATS="[${seats%,}]"
  local res; res=$(curl -s -X POST "$API/reservations" -H "Authorization: Bearer $USR" -H "$J" -d "{\"eventId\":\"$GEV\",\"seats\":$GSEATS}")
  GIDS=$(node -pe "JSON.stringify(JSON.parse(process.argv[1]).reservations.map(r=>r.id))" "$res")
}
# pay_group <idsJson> <cardJson> -> define HTTP, BODY y CODE
pay_group() {
  local out
  out=$(curl -s -m 20 -w '|%{http_code}' -X POST "$API/tickets/purchase" -H "Authorization: Bearer $USR" -H "$J" -d "{\"reservationIds\":$1,\"card\":$2}")
  HTTP="${out##*|}"; BODY="${out%|*}"
  CODE=$(json_get "$BODY" code); [ -n "$CODE" ] || CODE=$(json_get "$BODY" tickets.0.status)
}
reverse_ids() { node -pe "JSON.stringify(JSON.parse(process.argv[1]).reverse())" "$1"; }
group_statuses() { # estados de las reservas del grupo, separados por coma
  node -e "
    const ids = JSON.parse(process.argv[1]);
    const jwt = process.argv[2];
    (async () => {
      const out = [];
      for (const id of ids) {
        const r = await fetch(process.argv[3] + '/reservations/' + id, { headers: { Authorization: 'Bearer ' + jwt } });
        out.push((await r.json()).status);
      }
      console.log(out.join(','));
    })();" "$1" "$USR" "$API"
}

if [ -z "$ADM_TOKEN" ] || [ "$ADM_TOKEN" = "undefined" ]; then
  skip "GW-22..28" "no se pudo iniciar sesión como ADMIN"
else
  new_group 3
  pay_group "$GIDS" "$(card 4111111111111111)"
  check "GW-22a" "grupo de 3 reservas aprobado -> 201 con 3 tickets" "201 3" "$HTTP $(json_get "$BODY" tickets.length)"
  check "GW-22b" "monto total = 3 x 75000" "225000" "$(json_get "$BODY" amount)"
  check "GW-22c" "los 3 tickets comparten el mismo transactionId (un solo cobro)" "1" "$(node -pe "new Set(JSON.parse(process.argv[1]).tickets.map(t=>t.transactionId)).size" "$BODY")"
  check "GW-22d" "las 3 reservas quedan CONFIRMED" "CONFIRMED,CONFIRMED,CONFIRMED" "$(group_statuses "$GIDS")"
  check "GW-22e" "GET /tickets/me muestra 3 tickets" "3" "$(my_tickets)"
  pay_group "$GIDS" "$(card 4111111111111111)"
  check "GW-23a" "repetir la compra del grupo -> 409 DUPLICATE_PAYMENT" "409 DUPLICATE_PAYMENT" "$HTTP $CODE"
  check "GW-23b" "no se crearon más tickets" "3" "$(my_tickets)"

  new_group 8
  pay_group "$GIDS" "$(card 4111111111111111)"
  check "GW-24" "grupo de 8 reservas (el máximo del evento) -> 201 con 8 tickets y monto 600000" "201 8 600000" "$HTTP $(json_get "$BODY" tickets.length) $(json_get "$BODY" amount)"

  new_group 3
  pay_group "$GIDS" "$(card 4111111111110000)"
  check "GW-25a" "grupo con tarjeta rechazada (...0000) -> 402 PAYMENT_REJECTED" "402 PAYMENT_REJECTED" "$HTTP $CODE"
  check "GW-25b" "las 3 reservas siguen ACTIVE" "ACTIVE,ACTIVE,ACTIVE" "$(group_statuses "$GIDS")"
  pay_group "$GIDS" "$(card 4111111111111111)"
  check "GW-25c" "nuevo intento inmediato con otra tarjeta -> 201 (el reclamo se liberó)" "201" "$HTTP"

  new_group 3
  pay_group "$GIDS" "$(card 4111111111119999)"; check "GW-26a" "grupo con error simulado (...9999), intento 1 -> 502" "502 PAYMENT_GATEWAY_ERROR" "$HTTP $CODE"
  pay_group "$(reverse_ids "$GIDS")" "$(card 4111111111119999)"; check "GW-26b" "intento 2 con los ids en otro orden (mismo conjunto) -> 502" "502 PAYMENT_GATEWAY_ERROR" "$HTTP $CODE"
  pay_group "$GIDS" "$(card 4111111111119999)"; check "GW-26c" "intento 3 -> 422 CARD_PROBLEM (el conteo es por conjunto)" "422 CARD_PROBLEM" "$HTTP $CODE"
  check "GW-26d" "las 3 reservas siguen ACTIVE" "ACTIVE,ACTIVE,ACTIVE" "$(group_statuses "$GIDS")"
  FIRST_TWO=$(node -pe "JSON.stringify(JSON.parse(process.argv[1]).slice(0,2))" "$GIDS")
  pay_group "$FIRST_TWO" "$(card 4111111111119999)"
  check "GW-26e" "otro conjunto (2 de las 3) con la misma tarjeta empieza su propio conteo -> 502" "502 PAYMENT_GATEWAY_ERROR" "$HTTP $CODE"

  TICKET_DB_DIR="$TICKET_API_DIR"
  if command -v docker >/dev/null 2>&1 && docker compose -f "$TICKET_DB_DIR/docker-compose.yml" --project-directory "$TICKET_DB_DIR" ps -q postgres 2>/dev/null | grep -q .; then
    new_group 3
    SECOND=$(node -pe "JSON.parse(process.argv[1])[1]" "$GIDS")
    docker compose -f "$TICKET_DB_DIR/docker-compose.yml" --project-directory "$TICKET_DB_DIR" exec -T postgres sh -c \
      "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"update reservations set expires_at = now() - interval '1 minute' where id='$SECOND'\"" >/dev/null 2>&1
    pay_group "$GIDS" "$(card 4111111111111111)"
    check "GW-27a" "grupo con una reserva vencida -> 409 RESERVATION_EXPIRED, sin cobrar" "409 RESERVATION_EXPIRED" "$HTTP $CODE"
    OTHERS=$(node -pe "JSON.stringify(JSON.parse(process.argv[1]).filter(i=>i!==process.argv[2]))" "$GIDS" "$SECOND")
    pay_group "$OTHERS" "$(card 4111111111111111)"
    check "GW-27b" "las 2 vigentes se pueden pagar solas -> 201" "201" "$HTTP"
  else
    skip "GW-27" "no se pudo acceder a la base de ticket-api con docker"
  fi

  new_group 3
  pay_group "$GIDS" "$(card 4111111111111111)"
  CANCEL=$(curl -s -X POST "$API/events/$GEV/cancel" -H "Authorization: Bearer $ADM_TOKEN")
  check "GW-28a" "cancelar un evento con un pedido de 3 tickets -> cancelledTickets 3" "3" "$(json_get "$CANCEL" cancelledTickets)"
fi

# ============================== GW-18..21: compras de varias reservas (group-purchase) ==============================
# Llaman a la pasarela DIRECTAMENTE (sin ticket-api) para comprobar lo que el diseño de
# `group-purchase` supone de ella: el `reservationId` es un texto libre, el conteo de errores es por
# id y tarjeta, hay un tope de monto y la idempotencia es por id (ignora el monto y la tarjeta).
new_uuid() { node -pe "require('crypto').randomUUID()"; }
# gw_pay <id> <monto> <número> -> define GHTTP y GBODY
gw_pay() {
  local out
  out=$(curl -s -m 15 -w '\n%{http_code}' -X POST "$GATEWAY_URL/payments" \
    -H "Authorization: Bearer ${PAYMENT_GATEWAY_API_KEY:-}" -H "$J" \
    -d "{\"reservationId\":\"$1\",\"amount\":$2,\"card\":{\"brand\":\"VISA\",\"number\":\"$3\",\"expiry\":\"12/30\",\"cvv\":\"123\"}}")
  GHTTP=${out##*$'\n'}; GBODY=${out%$'\n'*}
}

section "GW-18  Un solo cobro por varias reservas"
if [ -z "${PAYMENT_GATEWAY_API_KEY:-}" ]; then
  skip "GW-18..21" "falta PAYMENT_GATEWAY_API_KEY (se lee del .env de ticket-api)"
else
  MIN_ID=$(new_uuid)
  gw_pay "$MIN_ID" 450000.00 4111111111111111
  check "GW-18a" "id arbitrario (identificador de un conjunto de 3 reservas) y monto sumado -> 200 APPROVED" "200 APPROVED" "$GHTTP $(json_get "$GBODY" status)"

  section "GW-19  Conteo de errores por id y tarjeta"
  EID=$(new_uuid)
  gw_pay "$EID" 100.00 4111111111119999; R1="$GHTTP"
  gw_pay "$EID" 100.00 4111111111119999; R2="$GHTTP"
  gw_pay "$EID" 100.00 4111111111119999; R3="$GHTTP $(json_get "$GBODY" code)"
  check "GW-19a" "mismo id y tarjeta: 502, 502 y al tercero 422 CARD_PROBLEM" "502 502 422 CARD_PROBLEM" "$R1 $R2 $R3"
  gw_pay "$(new_uuid)" 100.00 4111111111119999
  check "GW-19b" "otro id (otro conjunto de reservas) con la misma tarjeta: el conteo empieza de nuevo -> 502" "502" "$GHTTP"
  gw_pay "$EID" 100.00 4111111111111111
  check "GW-19c" "el mismo id con otra tarjeta -> 200" "200" "$GHTTP"

  section "GW-20  Tope de monto"
  gw_pay "$(new_uuid)" 9999999999.99 4111111111111111
  check "GW-20a" "monto de 9.999.999.999,99 (el máximo del precio de un evento) -> 200" "200" "$GHTTP"
  gw_pay "$(new_uuid)" 79999999999.92 4111111111111111
  check "GW-20b" "LÍMITE CONOCIDO: 8 x el precio máximo (79.999.999.999,92) -> la pasarela responde 500" "500" "$GHTTP"

  section "GW-21  Idempotencia por id (ignora monto y tarjeta)"
  IID=$(new_uuid)
  gw_pay "$IID" 100.00 4111111111111111; T1=$(json_get "$GBODY" transactionId)
  gw_pay "$IID" 100.00 4111111111111111; T2=$(json_get "$GBODY" transactionId)
  gw_pay "$IID" 999.00 4111111111111111; T3=$(json_get "$GBODY" transactionId)
  gw_pay "$IID" 100.00 5500000000000004; T4=$(json_get "$GBODY" transactionId)
  check "GW-21a" "repetir el mismo cobro devuelve el mismo transactionId" "$T1" "$T2"
  check "GW-21b" "con otro MONTO el mismo id devuelve el mismo transactionId (la pasarela no compara montos)" "$T1" "$T3"
  check "GW-21c" "con otra TARJETA el mismo id devuelve el mismo transactionId" "$T1" "$T4"
  SAME=0
  for round in 1 2 3 4 5 6; do
    CID=$(new_uuid)
    tmp1=$(mktemp); tmp2=$(mktemp)
    ( gw_pay "$CID" 100.00 4111111111111111; json_get "$GBODY" transactionId > "$tmp1" ) &
    ( gw_pay "$CID" 100.00 4111111111111111; json_get "$GBODY" transactionId > "$tmp2" ) &
    wait
    [ -s "$tmp1" ] && [ "$(cat "$tmp1")" = "$(cat "$tmp2")" ] && SAME=$((SAME+1))
    rm -f "$tmp1" "$tmp2"
  done
  check "GW-21d" "dos cobros simultáneos con el mismo id devuelven el mismo transactionId (6 rondas)" "6" "$SAME"
fi

# ============================== RESUMEN ==============================
section "Resumen"
printf '  Pasaron: %s   Fallaron: %s   Omitidos: %s\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  Casos fallidos:\n'; printf '    - %s\n' "${FAILED_CASES[@]}"
  exit 1
fi
exit 0
