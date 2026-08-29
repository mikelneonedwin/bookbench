export interface MockEnrollment {
  id: string;
  courseId: string;
  studentId: string;
  serialNumber: string;
  regNumber: string;
  qrUrl: string;
  copyToken: string;
}

const FACULTIES = ["SC", "EG", "AR", "ED", "MS", "LA", "HS"];
const DEPTS = ["CO", "ME", "EE", "CH", "PY", "BC", "MC", "EC"];

export function generateRegistrationNumber(index: number): string {
  const year = String(20 + (index % 5)).padStart(2, "0");
  const faculty = FACULTIES[index % FACULTIES.length];
  const dept = DEPTS[(index * 3) % DEPTS.length];
  const num = String(100 + (index % 9000)).padStart(index % 2 === 0 ? 3 : 4, "0");
  const suffix = index % 7 === 0 ? "TR" : "";
  return `${year}/${faculty}/${dept}/${num}${suffix}`;
}

export function generateMockEnrollments(count: number, courseId = "course-csc201"): MockEnrollment[] {
  const list: MockEnrollment[] = [];
  for (let i = 1; i <= count; i++) {
    const copyToken = `token_${crypto.randomUUID()}`;
    list.push({
      id: `enrollment_${i}`,
      courseId,
      studentId: `student_${i}`,
      serialNumber: String(i).padStart(3, "0"),
      regNumber: generateRegistrationNumber(i),
      qrUrl: `https://modools.app/enrollments/${courseId}/${copyToken}`,
      copyToken,
    });
  }
  return list;
}
