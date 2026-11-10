-- Thêm vai trò ADMIN (Admin tổng, quyền cao nhất). Chỉ thêm giá trị enum, không đổi dữ liệu cũ.
ALTER TABLE `users` MODIFY `role` ENUM('STAFF', 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT', 'ADMIN') NOT NULL;

ALTER TABLE `account_invitations` MODIFY `role` ENUM('STAFF', 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT', 'ADMIN') NOT NULL;
