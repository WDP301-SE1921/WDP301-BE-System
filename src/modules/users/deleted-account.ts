/**
 * Phụ huynh tự xóa tài khoản: email được thay bằng địa chỉ ẩn danh để email thật đăng ký lại được.
 * Tên miền `.invalid` không bao giờ có thật (RFC 2606), nên không email nào gửi tới được.
 */
export const DELETED_ACCOUNT_EMAIL_DOMAIN = 'deleted.invalid';

export const SELF_DELETE_REASON = 'Phụ huynh tự xóa tài khoản trên ứng dụng';

export function deletedAccountEmail(userId: string): string {
  return `deleted-${userId}@${DELETED_ACCOUNT_EMAIL_DOMAIN}`;
}

export function isDeletedAccountEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DELETED_ACCOUNT_EMAIL_DOMAIN}`);
}
