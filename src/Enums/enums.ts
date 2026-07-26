/**
 * Estados de una cita. Debe coincidir con el enum "EstadoCita" de PostgreSQL.
 *
 * Flujo:
 *   SOLICITADA -> PENDIENTE -> CONFIRMADA -> COMPLETADA
 *   (el cliente pide)  (recepcion aprueba)  (cliente confirma)  (doctor atiende)
 *
 * CANCELADA es alcanzable desde cualquier punto.
 */
export enum EstadoCita {
  SOLICITADA = 'SOLICITADA',
  PENDIENTE = 'PENDIENTE',
  COMPLETADA = 'COMPLETADA',
  CANCELADA = 'CANCELADA',
  CONFIRMADA = 'CONFIRMADA',
}
export enum HorarioLaboral {
  H08_00 = '08:00',
  H08_30 = '08:30',
  H09_00 = '09:00',
  H09_30 = '09:30',
  H10_00 = '10:00',
  H10_30 = '10:30',
  H11_00 = '11:00',
  H11_30 = '11:30',
  H13_00 = '13:00',
  H13_30 = '13:30',
  H14_00 = '14:00',
  H14_30 = '14:30',
  H15_00 = '15:00',
  H15_30 = '15:30',
  H16_00 = '16:00',
  H16_30 = '16:30',
}
