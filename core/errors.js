export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status; this.code = code; this.details = details;
  }
}
export const bad = (code, message, details) => new HttpError(400, code, message, details);
export const notFound = (message = 'Introuvable') => new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Accès refusé') => new HttpError(403, 'forbidden', message);
export const conflict = (code, message) => new HttpError(409, code, message);
