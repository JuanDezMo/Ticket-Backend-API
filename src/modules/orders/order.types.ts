export interface NewOrder {
  userId: string;
  eventId: string;
  /** Suma de los montos de las reservas del pedido. */
  amount: number;
}

export interface Order extends NewOrder {
  id: string;
  createdAt: Date;
}
