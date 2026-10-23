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
    -d "{\"reservationId\":\"$RID\",\"card\":$2}")
  HTTP="${out##*|}"; BODY="${out%|*}"
  CODE=$(json_get "$BODY" code); [ -n "$CODE" ] || CODE=$(json_get "$BODY" status)
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
check "GW-01b" "ticket ISSUED" "ISSUED" "$(json_get "$BODY" status)"
check "GW-01c" "monto = precio del evento" "75000" "$(json_get "$BODY" amount)"
TICKET1=$(json_get "$BODY" id); TXN1=$(json_get "$BODY" transactionId)
check "GW-01d" "el seat queda SOLD" "SOLD" "$(seat_status A1)"
check "GW-01e" "GET /tickets/me muestra 1 ticket" "1" "$(my_tickets)"
[ "$GWDB" = "1" ] && check "GW-01f" "la pasarela guardó 1 intento APPROVED" "1 APPROVED;" "$(gw_attempts "$RID")"
pay "$API" "$(card 4111111111111111)"
check "GW-02a" "repetir la compra -> HTTP 200" "200" "$HTTP"
check "GW-02b" "mismo ticket" "$TICKET1" "$(json_get "$BODY" id)"
check "GW-02c" "mismo transactionId" "$TXN1" "$(json_get "$BODY" transactionId)"
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
check "GW-05a" "con otra tarjeta -> 201 ISSUED" "201 ISSUED" "$HTTP $(json_get "$BODY" status)"
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
check "GW-11" "brand visa (minúscula) -> 201 ISSUED" "201 ISSUED" "$HTTP $(json_get "$BODY" status)"

# ============================== DATOS INVÁLIDOS ==============================
section "GW-12..15  Datos de tarjeta (los valida la pasarela)"
new_reservation "$API" "$EV" A5
pay "$API" "$(card 4111111111111111 VISA 13/99)"; check "GW-12" "expiry 13/99 -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
pay "$API" "$(card 4111111111111111 VISA 01/20)"; check "GW-13" "tarjeta vencida -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
pay "$API" "$(card abc)";                          check "GW-14" "número 'abc' -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
check "GW-14s" "el seat sigue RESERVED" "RESERVED" "$(seat_status A5)"
[ "$GWDB" = "1" ] && check "GW-14g" "la pasarela no guarda intentos con formato inválido" "" "$(gw_attempts "$RID")"
pay "$API" "$(card 4111111111111234)"
check "GW-15" "número sin Luhn válido -> 201 ISSUED (no se valida Luhn)" "201 ISSUED" "$HTTP $(json_get "$BODY" status)"

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
    check "GW-17c" "reintento con el timeout normal -> 201 ISSUED" "201 ISSUED" "$HTTP $(json_get "$BODY" status)"
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

# ============================== RESUMEN ==============================
section "Resumen"
printf '  Pasaron: %s   Fallaron: %s   Omitidos: %s\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  Casos fallidos:\n'; printf '    - %s\n' "${FAILED_CASES[@]}"
  exit 1
fi
exit 0
