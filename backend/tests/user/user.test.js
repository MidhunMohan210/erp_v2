import request from "supertest";

import app from "../../app.js";
import AccountGroup from "../../Model/AccountGroup.js";
import Party from "../../Model/partySchema.js";
import User from "../../Model/UserSchema.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

const createOwnedStaffUser = async ({
  owner,
  userName = "Staff User",
  email = "staff@example.com",
  mobileNumber = "9111111111",
  password = "Password123",
  role = "staff",
} = {}) => {
  return User.create({
    userName,
    email,
    mobileNumber,
    password,
    role,
    owner,
  });
};

const createAccountGroup = async ({
  cmp_id,
  Primary_user_id,
  accountGroup = "Sundry Debtors",
  accountGroup_id = "AG-USER-001",
} = {}) => {
  return AccountGroup.create({
    cmp_id,
    Primary_user_id,
    accountGroup,
    accountGroup_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
  });
};

describe("User staff routes", () => {
  it("creates a staff user successfully", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Owner Admin",
        mobileNumber: "9000010001",
        email: "owner-admin@example.com",
      },
    });

    const res = await request(app)
      .post("/api/users/staff")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        userName: "  Staff Member  ",
        email: "  staff-member@example.com  ",
        mobileNumber: " 9888800001 ",
        password: "Password123",
      });

    const userInDb = await User.findOne({ email: "staff-member@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("User created successfully");
    expect(res.body.user.userName).toBe("Staff Member");
    expect(res.body.user.email).toBe("staff-member@example.com");
    expect(res.body.user.mobileNumber).toBe("9888800001");
    expect(res.body.user.role).toBe("staff");
    expect(res.body.user.owner).toBe(String(admin.user._id));
    expect(res.body.user).not.toHaveProperty("password");
    expect(userInDb).not.toBeNull();
    expect(userInDb.role).toBe("staff");
    expect(String(userInDb.owner)).toBe(String(admin.user._id));
    expect(userInDb.password).not.toBe("Password123");
  });

  it("creates multiple staff users without emails and allows mobile login", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Email Optional Admin",
        mobileNumber: "9000010090",
        email: "email-optional-admin@example.com",
      },
    });

    const createRes = await request(app)
      .post("/api/users/staff")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        userName: "Mobile Only Staff",
        mobileNumber: "9888800090",
        password: "Password123",
      });

    const secondCreateRes = await request(app)
      .post("/api/users/staff")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        userName: "Second Mobile Only Staff",
        mobileNumber: "9888800091",
        password: "Password123",
      });

    const loginRes = await request(app).post("/api/auth/Login").send({
      identifier: "9888800090",
      password: "Password123",
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.user.userName).toBe("Mobile Only Staff");
    expect(createRes.body.user).not.toHaveProperty("email");
    expect(secondCreateRes.status).toBe(201);
    expect(secondCreateRes.body.user.userName).toBe(
      "Second Mobile Only Staff"
    );
    expect(secondCreateRes.body.user).not.toHaveProperty("email");
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mobileNumber).toBe("9888800090");
  });

  it("returns 400 when required fields are missing while creating staff user", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Owner Admin Two",
        mobileNumber: "9000010002",
        email: "owner-admin-two@example.com",
      },
    });

    const res = await request(app)
      .post("/api/users/staff")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        userName: "Missing Staff",
        email: "missing-staff@example.com",
      });

    const userCount = await User.countDocuments({
      email: "missing-staff@example.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("All required fields must be provided");
    expect(userCount).toBe(0);
  });

  it("returns 400 when email or mobile is already registered", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Owner Admin Three",
        mobileNumber: "9000010003",
        email: "owner-admin-three@example.com",
      },
    });

    await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Existing Staff",
      email: "existing-staff@example.com",
      mobileNumber: "9888800003",
    });

    const res = await request(app)
      .post("/api/users/staff")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        userName: "Duplicate Staff",
        email: "existing-staff@example.com",
        mobileNumber: "9888809999",
        password: "Password123",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email or mobile already registered");
  });

  it("returns 401 when creating staff user without auth", async () => {
    const res = await request(app).post("/api/users/staff").send({
      userName: "No Auth Staff",
      email: "no-auth-staff@example.com",
      mobileNumber: "9888800004",
      password: "Password123",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("returns 403 when a staff user tries to create another staff user", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Owner Admin Four",
        mobileNumber: "9000010004",
        email: "owner-admin-four@example.com",
      },
    });

    await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Existing Staff Login",
      email: "existing-staff-login@example.com",
      mobileNumber: "9888800005",
    });

    const staffLogin = await request(app).post("/api/auth/Login").send({
      identifier: "existing-staff-login@example.com",
      password: "Password123",
    });

    const res = await request(app)
      .post("/api/users/staff")
      .set("Authorization", `Bearer ${staffLogin.body.token}`)
      .send({
        userName: "Blocked Staff Create",
        email: "blocked-staff-create@example.com",
        mobileNumber: "9888800006",
        password: "Password123",
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Admin access required");
  });

  it("lists only staff users owned by the current admin", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "List Admin",
        mobileNumber: "9000010005",
        email: "list-admin@example.com",
      },
    });
    const otherAdmin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Other List Admin",
        mobileNumber: "9000010006",
        email: "other-list-admin@example.com",
      },
    });

    await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Alpha Staff",
      email: "alpha-staff@example.com",
      mobileNumber: "9888800007",
    });
    await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Beta Staff",
      email: "beta-staff@example.com",
      mobileNumber: "9888800008",
    });
    await createOwnedStaffUser({
      owner: otherAdmin.user._id,
      userName: "Other Staff",
      email: "other-staff@example.com",
      mobileNumber: "9888800009",
    });

    const res = await request(app)
      .get("/api/users/staff")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((user) => user.userName).sort()).toEqual([
      "Alpha Staff",
      "Beta Staff",
    ]);
    res.body.forEach((user) => {
      expect(user.role).toBe("staff");
      expect(user).not.toHaveProperty("password");
      expect(user.owner).toBe(String(admin.user._id));
    });
  });

  it("gets a single owned staff user successfully", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Get Admin",
        mobileNumber: "9000010010",
        email: "get-admin@example.com",
      },
    });

    const staffUser = await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Fetch Staff",
      email: "fetch-staff@example.com",
      mobileNumber: "9888800010",
    });

    const res = await request(app)
      .get(`/api/users/staff/${staffUser._id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(staffUser._id));
    expect(res.body.userName).toBe("Fetch Staff");
    expect(res.body.email).toBe("fetch-staff@example.com");
    expect(res.body).not.toHaveProperty("password");
  });

  it("returns 404 when staff user is not owned by the current admin", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Scope Admin",
        mobileNumber: "9000010011",
        email: "scope-admin@example.com",
      },
    });
    const otherAdmin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Other Scope Admin",
        mobileNumber: "9000010012",
        email: "other-scope-admin@example.com",
      },
    });

    const otherStaff = await createOwnedStaffUser({
      owner: otherAdmin.user._id,
      userName: "Other Owner Staff",
      email: "other-owner-staff@example.com",
      mobileNumber: "9888800011",
    });

    const res = await request(app)
      .get(`/api/users/staff/${otherStaff._id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("User not found");
  });

  it("updates an owned staff user successfully", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Update Admin",
        mobileNumber: "9000010013",
        email: "update-admin@example.com",
      },
    });

    const staffUser = await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Original Staff",
      email: "original-staff@example.com",
      mobileNumber: "9888800012",
    });

    const res = await request(app)
      .put(`/api/users/staff/${staffUser._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        userName: " Updated Staff ",
        email: " updated-staff@example.com ",
        mobileNumber: " 9888800013 ",
        password: "NewPassword123",
      });

    const updatedUser = await User.findById(staffUser._id);
    const loginRes = await request(app).post("/api/auth/Login").send({
      identifier: "updated-staff@example.com",
      password: "NewPassword123",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("User updated");
    expect(res.body.user.userName).toBe("Updated Staff");
    expect(res.body.user.email).toBe("updated-staff@example.com");
    expect(res.body.user.mobileNumber).toBe("9888800013");
    expect(res.body.user).not.toHaveProperty("password");
    expect(updatedUser.userName).toBe("Updated Staff");
    expect(updatedUser.email).toBe("updated-staff@example.com");
    expect(updatedUser.mobileNumber).toBe("9888800013");
    expect(updatedUser.password).not.toBe("NewPassword123");
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe("updated-staff@example.com");
  });

  it("deletes an owned staff user successfully when no dependencies exist", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Delete Admin",
        mobileNumber: "9000010014",
        email: "delete-admin@example.com",
      },
    });

    const staffUser = await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Delete Staff",
      email: "delete-staff@example.com",
      mobileNumber: "9888800014",
    });

    const res = await request(app)
      .delete(`/api/users/staff/${staffUser._id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    const userInDb = await User.findById(staffUser._id);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("User deleted");
    expect(userInDb).toBeNull();
  });

  it("returns conflict when deleting staff user with related transactional data", async () => {
    const admin = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Dependency Admin",
        mobileNumber: "9000010015",
        email: "dependency-admin@example.com",
      },
    });

    const staffUser = await createOwnedStaffUser({
      owner: admin.user._id,
      userName: "Blocked Staff",
      email: "blocked-staff@example.com",
      mobileNumber: "9888800015",
    });

    const companyId = new User()._id;
    const accountGroup = await createAccountGroup({
      cmp_id: companyId,
      Primary_user_id: admin.user._id,
      accountGroup_id: "AG-USER-DEPENDENCY-001",
    });

    await Party.create({
      cmp_id: companyId,
      Primary_user_id: admin.user._id,
      accountGroup: accountGroup._id,
      partyName: "Dependency Party",
      party_master_id: "PARTY-USER-DEPENDENCY-001",
      created_by: staffUser._id,
      source: "web",
    });

    const res = await request(app)
      .delete(`/api/users/staff/${staffUser._id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    const userInDb = await User.findById(staffUser._id);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      "Cannot delete user because related transactional data exists",
    );
    expect(userInDb).not.toBeNull();
  });
});
