export class LichessAuthError extends Error {
  override name = 'LichessAuthError'
}

export class LichessHttpError extends Error {
  override name = 'LichessHttpError'

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
