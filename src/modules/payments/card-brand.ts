import { AppError } from '../../shared/errors/index.js';
import { CARD_BRAND_VALUES, type CardBrand } from './payment.types.js';

/**
 * Valida la franquicia antes de llamar a la pasarela.
 * Ausente, nula o vacía -> CARD_BRAND_REQUIRED; fuera de la lista -> CARD_BRAND_NOT_ALLOWED.
 * Se acepta en cualquier combinación de mayúsculas y se devuelve en mayúsculas.
 */
export function parseCardBrand(value: unknown): CardBrand {
  if (value === undefined || value === null) throw new AppError('CARD_BRAND_REQUIRED');
  if (typeof value !== 'string') throw new AppError('CARD_BRAND_NOT_ALLOWED');
  const brand = value.trim().toUpperCase();
  if (brand === '') throw new AppError('CARD_BRAND_REQUIRED');
  if (!CARD_BRAND_VALUES.includes(brand as CardBrand)) throw new AppError('CARD_BRAND_NOT_ALLOWED');
  return brand as CardBrand;
}
