export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_events: {
        Row: {
          agent: Database["public"]["Enums"]["agent_name"]
          created_at: string
          event_type: string
          id: number
          input_summary: string | null
          metadata: Json
          output_summary: string | null
          run_id: string
          task_id: string | null
        }
        Insert: {
          agent: Database["public"]["Enums"]["agent_name"]
          created_at?: string
          event_type: string
          id?: never
          input_summary?: string | null
          metadata?: Json
          output_summary?: string | null
          run_id: string
          task_id?: string | null
        }
        Update: {
          agent?: Database["public"]["Enums"]["agent_name"]
          created_at?: string
          event_type?: string
          id?: never
          input_summary?: string | null
          metadata?: Json
          output_summary?: string | null
          run_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_run_id_fkey"
            columns: ["task_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id", "run_id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          max_task_iterations: number
          owner_id: string
          request: string
          schema_version: number
          status: Database["public"]["Enums"]["run_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          max_task_iterations?: number
          owner_id: string
          request: string
          schema_version?: number
          status?: Database["public"]["Enums"]["run_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          max_task_iterations?: number
          owner_id?: string
          request?: string
          schema_version?: number
          status?: Database["public"]["Enums"]["run_status"]
          updated_at?: string
        }
        Relationships: []
      }
      agent_tasks: {
        Row: {
          acceptance_criteria: Json
          created_at: string
          description: string
          id: string
          iteration_count: number
          last_test_report: Json | null
          max_iterations: number
          run_id: string
          sequence: number
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          acceptance_criteria?: Json
          created_at?: string
          description: string
          id?: string
          iteration_count?: number
          last_test_report?: Json | null
          max_iterations?: number
          run_id: string
          sequence: number
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          acceptance_criteria?: Json
          created_at?: string
          description?: string
          id?: string
          iteration_count?: number
          last_test_report?: Json | null
          max_iterations?: number
          run_id?: string
          sequence?: number
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          content: string
          created_at: string
          created_by: Database["public"]["Enums"]["agent_name"]
          id: string
          path: string
          revision: number
          run_id: string
          task_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          created_by: Database["public"]["Enums"]["agent_name"]
          id?: string
          path: string
          revision: number
          run_id: string
          task_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: Database["public"]["Enums"]["agent_name"]
          id?: string
          path?: string
          revision?: number
          run_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_task_id_run_id_fkey"
            columns: ["task_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id", "run_id"]
          },
        ]
      }
      step_attempts: {
        Row: {
          agent: Database["public"]["Enums"]["agent_name"]
          attempt_number: number
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          input_summary: string | null
          lease_expires_at: string | null
          next_attempt_at: string | null
          output_summary: string | null
          run_id: string
          status: Database["public"]["Enums"]["step_status"]
          task_id: string | null
        }
        Insert: {
          agent: Database["public"]["Enums"]["agent_name"]
          attempt_number: number
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          input_summary?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string | null
          output_summary?: string | null
          run_id: string
          status?: Database["public"]["Enums"]["step_status"]
          task_id?: string | null
        }
        Update: {
          agent?: Database["public"]["Enums"]["agent_name"]
          attempt_number?: number
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          input_summary?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string | null
          output_summary?: string | null
          run_id?: string
          status?: Database["public"]["Enums"]["step_status"]
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "step_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_attempts_task_id_run_id_fkey"
            columns: ["task_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id", "run_id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          run_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          run_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          run_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_run_id_fkey"
            columns: ["depends_on_task_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id", "run_id"]
          },
          {
            foreignKeyName: "task_dependencies_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_run_id_fkey"
            columns: ["task_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id", "run_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      agent_name: "orchestrator" | "develop" | "testing" | "system"
      run_status:
        | "planning"
        | "running"
        | "retry_wait"
        | "completed"
        | "failed"
        | "cancelled"
      step_status: "pending" | "running" | "retry_wait" | "succeeded" | "failed"
      task_status: "pending" | "developing" | "testing" | "failed" | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_name: ["orchestrator", "develop", "testing", "system"],
      run_status: [
        "planning",
        "running",
        "retry_wait",
        "completed",
        "failed",
        "cancelled",
      ],
      step_status: ["pending", "running", "retry_wait", "succeeded", "failed"],
      task_status: ["pending", "developing", "testing", "failed", "completed"],
    },
  },
} as const
