import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Mail,
  Phone,
  Users,
} from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";

import api from "../../api/client/apiClient";
import { updateUser } from "../../api/client/userApi";
import { useUserByIdQuery, userQueryKeys } from "@/hooks/queries/userQueries";
import { ROUTES } from "@/routes/paths";

const passwordSchema = z
  .string()
  .min(8, "Min 8 characters")
  .regex(
    /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
    "Password must contain upper, lower, number and special char",
  );

const baseSchema = z.object({
  userName: z.string().min(1, "Name is required"),
  email: z.union([z.literal(""), z.string().email("Invalid email")]),
  mobileNumber: z
    .string()
    .min(7, "Mobile is required")
    .regex(/^\d+$/, "Mobile must be digits"),
});

const createSchema = baseSchema.extend({
  password: passwordSchema,
});

const editSchema = baseSchema.extend({
  password: z.union([z.literal(""), passwordSchema]).optional(),
});

const inputClass =
  "h-10 w-full rounded-sm border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";
const errorClass = "mt-1 text-xs text-rose-500";

function InputIcon({ children }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
      {children}
    </span>
  );
}

export default function UserCreatePage() {
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = searchParams.get("userId");
  const isEdit = Boolean(userId);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm({
    resolver: zodResolver(isEdit ? editSchema : createSchema),
    defaultValues: {
      userName: "",
      email: "",
      mobileNumber: "",
      password: "",
    },
  });

  const {
    data: user,
    isLoading: loadingUser,
    isError,
    error,
  } = useUserByIdQuery(userId, isEdit);

  useEffect(() => {
    if (!isError) return;
    toast.error(error?.message || "Failed to load user");
  }, [error, isError]);

  useEffect(() => {
    if (!user) return;

    reset({
      userName: user.userName || "",
      email: user.email || "",
      mobileNumber: user.mobileNumber || "",
      password: "",
    });
  }, [reset, user]);

  const onSubmit = async (values) => {
    try {
      const payload = {
        userName: values.userName.trim(),
        email: values.email.trim(),
        mobileNumber: values.mobileNumber.trim(),
      };

      const hasNewPassword =
        typeof values.password === "string" && values.password.trim().length > 0;

      if (!isEdit) {
        payload.password = values.password.trim();
      } else if (hasNewPassword) {
        payload.password = values.password.trim();
      }

      if (isEdit) {
        const res = await updateUser(userId, payload);
        toast.success(res?.data?.message || "User updated successfully");
      } else {
        const res = await api.post("/users/staff", payload);
        toast.success(res?.data?.message || "User created successfully");
      }

      await queryClient.invalidateQueries({ queryKey: userQueryKeys.all });
      if (userId) {
        queryClient.removeQueries({
          queryKey: userQueryKeys.detail(userId),
          exact: true,
        });
      }

      navigate(ROUTES.mastersUsers, { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || "User save failed";
      toast.error(msg);
    }
  };

  return (
    <div className="w-full font-[sans-serif]">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-sm bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 md:text-lg">
                {isEdit ? "Edit User" : "Create User"}
              </h2>
              <p className="text-xs text-slate-500 md:text-sm">
                {isEdit
                  ? "Update your staff user details"
                  : "Fill the details to create a new staff user"}
              </p>
            </div>
          </div>

          {loadingUser && isEdit ? (
            <p className="text-sm text-slate-500">Loading user...</p>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-5"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Enter user name"
                      {...register("userName")}
                    />
                    <InputIcon>
                      <Users className="h-4 w-4" />
                    </InputIcon>
                  </div>
                  {errors.userName && (
                    <p className={errorClass}>{errors.userName.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Email</label>
                  <div className="relative">
                    <input
                      type="email"
                      className={inputClass}
                      placeholder="name@example.com"
                      {...register("email")}
                    />
                    <InputIcon>
                      <Mail className="h-4 w-4" />
                    </InputIcon>
                  </div>
                  {errors.email && (
                    <p className={errorClass}>{errors.email.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Mobile</label>
                  <div className="relative">
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Enter mobile number"
                      {...register("mobileNumber")}
                    />
                    <InputIcon>
                      <Phone className="h-4 w-4" />
                    </InputIcon>
                  </div>
                  {errors.mobileNumber && (
                    <p className={errorClass}>{errors.mobileNumber.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    Password
                    {isEdit && (
                      <span className="ml-1 text-[11px] text-slate-400">
                        Leave blank to keep current password
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className={inputClass}
                      placeholder={
                        isEdit ? "Enter new password" : "Create a password"
                      }
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 transition-colors hover:text-slate-600"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {errors.password && (
                    <p className={errorClass}>{errors.password.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => navigate(ROUTES.mastersUsers, { replace: true })}
                  className="rounded-sm border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-sm bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting
                    ? isEdit
                      ? "Updating..."
                      : "Saving..."
                    : isEdit
                      ? "Update User"
                      : "Create User"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
