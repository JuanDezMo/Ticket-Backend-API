#!/usr/bin/env bash
# Verificación mínima de los LÍMITES de seats de ticket-api contra la API REAL:
# límite por evento (maxSeatsPerUser), reserva por lotes y tope global de reservas activas.
# Requiere: bash, curl y node. La API debe estar levantada y migrada.
#
# Uso:   ./scripts/verify-limits.sh
# Variables opcionales (con su valor por defecto):
#   TICKET_API_URL=http://localhost:3000     GATEWAY_URL=http://localhost:8080
#   MAX_ACTIVE_HOLDS=8                       mismo valor que MAX_ACTIVE_HOLDS_PER_USER de la API (1 a 16)
#   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD   (si no se definen, se leen del .env de ticket-api)
# Los casos con compra (L-20) se omiten si la pasarela no responde.
# Cada ejecución crea sus propios eventos y usuarios (nombres únicos), así que se puede repetir
# sin limpiar nada, y cancela al final los eventos que creó.
# Código de salida: 0 si todo pasa, 1 si algún caso falla, 2 si faltan prerrequisitos.
#
# Por qué es consistente: cada evento se crea con 40 seats (filas A a D) y los seats se piden con
# `take`, que reparte etiquetas válidas en orden y aborta con error de script si se acabaran;
# así un caso nunca falla por pedir un seat que no existe.

set -u

TICKET_API_DIR="${TICKET_API_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API="${TICKET_API_URL:-http://localhost:3000}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
MAX_ACTIVE_HOLDS="${MAX_ACTIVE_HOLDS:-8}"
J='Content-Type: application/json'
CAPACITY=40            # filas A a D de 10 seats
RUN="$(date +%s)-$RANDOM"

if [ -f "$TICKET_API_DIR/.env" ]; then
  set -a; . "$TICKET_API_DIR/.env"; set +a
fi
: "${SEED_ADMIN_EMAIL:?Define SEED_ADMIN_EMAIL (o créalo en el .env de ticket-api)}"
: "${SEED_ADMIN_PASSWORD:?Define SEED_ADMIN_PASSWORD (o créalo en el .env de ticket-api)}"
command -v node >/dev/null 2>&1 || { echo "Falta node."; exit 2; }
if [ "$MAX_ACTIVE_HOLDS" -lt 1 ] || [ "$MAX_ACTIVE_HOLDS" -gt 16 ]; then
  echo "MAX_ACTIVE_HOLDS debe estar entre 1 y 16 (el script reparte las reservas en dos eventos de límite 8)."; exit 2
fi

PASS=0; FAIL=0; SKIP=0
FAILED_CASES=()
CREATED_EVENTS=()

# ---------- utilidades ----------
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pass() { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); FAILED_CASES+=("$1"); printf '  \033[31mFAIL\033[0m  %s  (%s)\n' "$1" "$2"; }
skip() { SKIP=$((SKIP+1)); printf '  \033[33mSKIP\033[0m  %s  (%s)\n' "$1" "$2"; }
# check <id> <descripción> <esperado> <actual>
check() { if [ "$3" = "$4" ]; then pass "$1  $2"; else fail "$1  $2" "esperado: '$3' | obtenido: '$4'"; fi; }
abort() { echo "ERROR DEL SCRIPT: $1"; exit 2; }

json_get() { node -e "const j=JSON.parse(process.argv[1]);const v=process.argv[2].split('.').reduce((a,k)=>a==null?a:a[k],j);console.log(v===undefined?'':v)" "$1" "$2"; }
# Cuántos vencimientos distintos hay en una respuesta de reservas (1 = todas comparten vencimiento)
distinct_expiry() { node -e "const j=JSON.parse(process.argv[1]);console.log(new Set(j.reservations.map(r=>r.expiresAt)).size)" "$1"; }

# ---------- seats: etiquetas válidas, repartidas en orden ----------
CURSOR=0
# take <n> -> define SEATS con las próximas n etiquetas libres del evento actual, por ejemplo ["A1","A2"].
# Se llama SIN sustitución de comandos ($(...)): así el cursor avanza en esta misma shell.
take() {
  local n=$1
  [ $((CURSOR + n)) -le "$CAPACITY" ] || abort "se piden $n seats pero el evento solo tiene $CAPACITY (ya se usaron $CURSOR)"
  SEATS=$(node -e "const [s,n]=process.argv.slice(1).map(Number);console.log(JSON.stringify(Array.from({length:n},(_,k)=>{const i=s+k;return String.fromCharCode(65+Math.floor(i/10))+(i%10+1)})))" "$CURSOR" "$n")
  CURSOR=$((CURSOR + n))
}

# ---------- API ----------
api() { # api <método> <ruta> <token> [cuerpo] -> define HTTP, BODY y CODE
  local out
  out=$(curl -s -m 20 -w '\n%{http_code}' -X "$1" "$API$2" -H "Authorization: Bearer $3" -H "$J" ${4:+-d "$4"})
  HTTP=${out##*$'\n'}; BODY=${out%$'\n'*}
  CODE=$(json_get "$BODY" code 2>/dev/null || true)
}
admin_login() {
  curl -s -X POST "$API/auth/login" -H "$J" \
    -d "{\"email\":\"$SEED_ADMIN_EMAIL\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken"
}
# new_user -> define TOKEN
new_user() {
  local email="limits-$RUN-$((++USER_SEQ))@example.com"
  curl -s -o /dev/null -X POST "$API/auth/register" -H "$J" -d "{\"email\":\"$email\",\"password\":\"password-123\"}"
  TOKEN=$(curl -s -X POST "$API/auth/login" -H "$J" -d "{\"email\":\"$email\",\"password\":\"password-123\"}" \
    | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")
  [ -n "$TOKEN" ] && [ "$TOKEN" != "undefined" ] || abort "no se pudo crear el usuario $email"
}
USER_SEQ=0
START_DATE=$(date -u -d '+1 year' +%Y-%m-%dT20:00:00Z 2>/dev/null || date -u -v+1y +%Y-%m-%dT20:00:00Z)
END_DATE=${START_DATE/T20/T23}
# event_body <nombre> <capacidad> <límite|""> -> cuerpo de POST /events (sin el límite si va vacío)
event_body() {
  local limit=""; [ -n "$3" ] && limit="\"maxSeatsPerUser\":$3,"
  echo "{\"name\":\"$1\",\"description\":\"verify-limits\",\"type\":\"CONCERT\",\"venue\":\"Hall\",\"price\":100,\"capacity\":$2,${limit}\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\"}"
}
# new_event <límite> -> define EVENT (con CAPACITY seats) y reinicia el reparto de seats
new_event() {
  api POST /events "$ADMIN" "$(event_body "Limites $RUN #$((++EVENT_SEQ))" "$CAPACITY" "$1")"
  [ "$HTTP" = "201" ] || abort "no se pudo crear un evento con límite $1: HTTP $HTTP $BODY"
  EVENT=$(json_get "$BODY" id); CREATED_EVENTS+=("$EVENT"); CURSOR=0
}
EVENT_SEQ=0
# reserve <token> <evento> <seatsJson> -> define HTTP, BODY, CODE
reserve() { api POST /reservations "$1" "{\"eventId\":\"$2\",\"seats\":$3}"; }
# seat_status <token> <evento> <etiqueta>
seat_status() {
  api GET "/events/$2/seats" "$1"
  node -e "const j=JSON.parse(process.argv[1]);const s=j.data.find(x=>x.label===process.argv[2]);console.log(s?s.status:'NO EXISTE')" "$BODY" "$3"
}
cleanup() {
  for id in "${CREATED_EVENTS[@]:-}"; do
    [ -n "$id" ] && curl -s -o /dev/null -X POST "$API/events/$id/cancel" -H "Authorization: Bearer $ADMIN"
  done
}

# ---------- prerrequisitos ----------
curl -s -m 5 "$API/health" | grep -q UP || { echo "La API no responde en $API (levántala y migra la base)."; exit 2; }
ADMIN=$(admin_login)
[ -n "$ADMIN" ] && [ "$ADMIN" != "undefined" ] || { echo "No se pudo iniciar sesión como ADMIN con SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD."; exit 2; }
trap cleanup EXIT

echo "API: $API   tope global esperado: $MAX_ACTIVE_HOLDS   corrida: $RUN"

# ============================== L-0x  Crear el evento con su límite ==============================
section "L-01..06  Límite al crear el evento (maxSeatsPerUser)"
api POST /events "$ADMIN" "$(event_body "Sin limite $RUN" 20 "")"
check "L-01" "sin maxSeatsPerUser -> 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$HTTP $CODE"
api POST /events "$ADMIN" "$(event_body "Cero $RUN" 20 0)"
check "L-02" "límite 0 -> 400" "400" "$HTTP"
api POST /events "$ADMIN" "$(event_body "Nueve $RUN" 20 9)"
check "L-03" "límite 9 (máximo es 8) -> 400" "400" "$HTTP"
api POST /events "$ADMIN" "$(event_body "Mayor $RUN" 4 5)"
check "L-04" "límite 5 con capacidad 4 -> 400" "400" "$HTTP"
api POST /events "$ADMIN" "$(event_body "Uno $RUN" 20 1)"
check "L-05" "límite 1 (mínimo) -> 201 y se devuelve" "201 1" "$HTTP $(json_get "$BODY" maxSeatsPerUser)"
[ "$HTTP" = "201" ] && CREATED_EVENTS+=("$(json_get "$BODY" id)")
api POST /events "$ADMIN" "$(event_body "Ocho $RUN" 20 8)"
check "L-06" "límite 8 (máximo) -> 201 y se devuelve" "201 8" "$HTTP $(json_get "$BODY" maxSeatsPerUser)"
[ "$HTTP" = "201" ] && CREATED_EVENTS+=("$(json_get "$BODY" id)")

# ============================== L-1x  Límite por evento ==============================
section "L-10..14  Límite por evento"
new_user; U="$TOKEN"
new_event 1
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-10a" "límite 1: la primera reserva -> 201" "201" "$HTTP"
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-10b" "límite 1: la segunda -> 409 SEAT_LIMIT_REACHED" "409 SEAT_LIMIT_REACHED" "$HTTP $CODE"
check "L-10c" "el mensaje nombra el límite del evento" "You can hold up to 1 seats for this event" "$(json_get "$BODY" message)"

new_user; U="$TOKEN"
new_event 8
take 8; reserve "$U" "$EVENT" "$SEATS"
check "L-11a" "límite 8: un lote de 8 -> 201 con 8 reservas" "201 8" "$HTTP $(json_get "$BODY" reservations.length)"
check "L-11b" "las 8 comparten vencimiento" "1" "$(distinct_expiry "$BODY")"
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-11c" "límite 8: un seat más -> 409 SEAT_LIMIT_REACHED" "409 SEAT_LIMIT_REACHED" "$HTTP $CODE"

new_user; U="$TOKEN"
new_event 4
take 3; reserve "$U" "$EVENT" "$SEATS"
check "L-12a" "límite 4: 3 reservados -> 201" "201" "$HTTP"
take 2; PAIR="$SEATS"; reserve "$U" "$EVENT" "$PAIR"
check "L-12b" "con 3 reservados, pedir 2 (total 5) -> 409 SEAT_LIMIT_REACHED" "409 SEAT_LIMIT_REACHED" "$HTTP $CODE"
FIRST_OF_PAIR=$(node -pe "JSON.parse(process.argv[1])[0]" "$PAIR")
check "L-12c" "no se reservó ninguno de los 2 pedidos" "AVAILABLE" "$(seat_status "$U" "$EVENT" "$FIRST_OF_PAIR")"
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-12d" "con 3 reservados, pedir 1 (total 4) -> 201" "201" "$HTTP"
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-12e" "con 4 reservados, pedir 1 más -> 409 SEAT_LIMIT_REACHED" "409 SEAT_LIMIT_REACHED" "$HTTP $CODE"

new_user; A="$TOKEN"; new_user; B="$TOKEN"
new_event 1
take 1; reserve "$A" "$EVENT" "$SEATS"
take 1; reserve "$B" "$EVENT" "$SEATS"
check "L-13" "el límite es por usuario: otro usuario sí reserva en el mismo evento -> 201" "201" "$HTTP"

new_user; U="$TOKEN"
new_event 1
take 1; reserve "$U" "$EVENT" "$SEATS"
RID=$(json_get "$BODY" reservations.0.id)
api POST "/reservations/$RID/cancel" "$U"
check "L-14a" "cancelar la reserva -> 200 CANCELLED_BY_USER" "200 CANCELLED_BY_USER" "$HTTP $(json_get "$BODY" status)"
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-14b" "tras cancelar se libera el cupo y se puede reservar de nuevo -> 201" "201" "$HTTP"

# ============================== L-3x  Lote todo o nada y validación ==============================
section "L-30..33  Lote todo o nada y validación de la solicitud"
new_user; A="$TOKEN"; new_user; B="$TOKEN"
new_event 4
take 3; BATCH="$SEATS"                           # ["A1","A2","A3"]: B ocupará el seat del medio
MIDDLE=$(node -pe "JSON.parse(process.argv[1])[1]" "$BATCH")
reserve "$B" "$EVENT" "[\"$MIDDLE\"]"
reserve "$A" "$EVENT" "$BATCH"
check "L-30a" "lote con un seat ocupado -> 409 SEAT_NOT_AVAILABLE" "409 SEAT_NOT_AVAILABLE" "$HTTP $CODE"
check "L-30b" "el mensaje nombra el seat ocupado" "Seats not available: $MIDDLE" "$(json_get "$BODY" message)"
FIRST=$(node -pe "JSON.parse(process.argv[1])[0]" "$BATCH")
check "L-30c" "no se reservó ninguno de los demás seats del lote" "AVAILABLE" "$(seat_status "$A" "$EVENT" "$FIRST")"

reserve "$A" "$EVENT" "[]"
check "L-31a" "lote vacío -> 400" "400" "$HTTP"
reserve "$A" "$EVENT" "[\"A1\",\"A2\",\"A3\",\"A4\",\"A5\",\"A6\",\"A7\",\"A8\",\"A9\"]"
check "L-31b" "lote de 9 seats -> 400" "400" "$HTTP"
reserve "$A" "$EVENT" "[\"C1\",\"c1\"]"
check "L-32" "seats repetidos (C1 y c1) -> 400" "400" "$HTTP"
api POST /reservations "$A" "{\"eventId\":\"$EVENT\",\"seat\":\"C5\"}"
check "L-33" "el campo antiguo seat -> 400" "400" "$HTTP"

# ============================== L-4x  Tope global por cuenta ==============================
section "L-40..41  Tope global de reservas activas ($MAX_ACTIVE_HOLDS)"
new_user; U="$TOKEN"
FIRST_HALF=$(( (MAX_ACTIVE_HOLDS + 1) / 2 )); SECOND_HALF=$(( MAX_ACTIVE_HOLDS - FIRST_HALF ))
new_event 8; EV1="$EVENT"
take "$FIRST_HALF"; reserve "$U" "$EV1" "$SEATS"
check "L-40a" "$FIRST_HALF reservas en el primer evento -> 201" "201" "$HTTP"
new_event 8; EV2="$EVENT"
if [ "$SECOND_HALF" -gt 0 ]; then
  take "$SECOND_HALF"; reserve "$U" "$EV2" "$SEATS"
  check "L-40b" "$SECOND_HALF reservas en el segundo evento (total $MAX_ACTIVE_HOLDS) -> 201" "201" "$HTTP"
fi
take 1; reserve "$U" "$EV2" "$SEATS"
check "L-40c" "una reserva más supera el tope -> 409 HOLD_LIMIT_REACHED" "409 HOLD_LIMIT_REACHED" "$HTTP $CODE"

new_user; U="$TOKEN"
new_event 8
take 1; reserve "$U" "$EVENT" "$SEATS"
RID=$(json_get "$BODY" reservations.0.id)
api POST "/reservations/$RID/cancel" "$U"
take 1; reserve "$U" "$EVENT" "$SEATS"
check "L-41" "con una reserva cancelada el usuario no acumula contra el tope -> sigue pudiendo reservar" "201" "$HTTP"

# ============================== L-2x  Lo comprado cuenta (requiere la pasarela) ==============================
section "L-20  Un ticket comprado cuenta para el límite"
if [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$GATEWAY_URL/" 2>/dev/null)" = "000" ]; then
  skip "L-20" "la pasarela no responde en $GATEWAY_URL"
else
  new_user; U="$TOKEN"
  new_event 2
  take 2; reserve "$U" "$EVENT" "$SEATS"
  RID=$(json_get "$BODY" reservations.0.id); RID2=$(json_get "$BODY" reservations.1.id)
  api POST /tickets/purchase "$U" "{\"reservationId\":\"$RID\",\"card\":{\"brand\":\"VISA\",\"number\":\"4111111111111111\",\"expiry\":\"12/28\",\"cvv\":\"123\"}}"
  check "L-20a" "pagar una de las 2 reservas -> 201 ISSUED" "201 ISSUED" "$HTTP $(json_get "$BODY" status)"
  take 1; reserve "$U" "$EVENT" "$SEATS"
  check "L-20b" "1 ticket + 1 reserva activa = límite 2: pedir 1 más -> 409 SEAT_LIMIT_REACHED" "409 SEAT_LIMIT_REACHED" "$HTTP $CODE"
  api POST "/reservations/$RID2/cancel" "$U"
  take 1; reserve "$U" "$EVENT" "$SEATS"
  check "L-20c" "cancelar la reserva activa libera 1 cupo (el ticket se conserva) -> 201" "201" "$HTTP"
  take 1; reserve "$U" "$EVENT" "$SEATS"
  check "L-20d" "con el ticket y la nueva reserva (2) otro seat -> 409 SEAT_LIMIT_REACHED" "409 SEAT_LIMIT_REACHED" "$HTTP $CODE"
fi

# ============================== RESUMEN ==============================
section "Resumen"
printf '  Pasaron: %s   Fallaron: %s   Omitidos: %s\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  Casos fallidos:\n'; printf '    - %s\n' "${FAILED_CASES[@]}"
  exit 1
fi
exit 0
