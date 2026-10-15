-- Fix recursive messaging RLS policies without disabling RLS.
-- Apply this migration in the Supabase SQL Editor after the existing schema
-- and phase4-messaging migration.

CREATE OR REPLACE FUNCTION public.is_conversation_participant(
    p_conversation_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversation_participants AS participant
        WHERE participant.conversation_id = p_conversation_id
          AND participant.user_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.is_gambasket_admin(
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles AS role
        WHERE role.user_id = p_user_id
          AND role.role_id = 'admin'
          AND role.is_active = TRUE
    );
$$;

REVOKE ALL ON FUNCTION public.is_conversation_participant(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_gambasket_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_gambasket_admin(UUID) TO authenticated;

-- Replace every known version of the self-referencing participant policies.
DROP POLICY IF EXISTS "Participants can view conversation" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Conversation participants and admins can select" ON public.conversations;

DROP POLICY IF EXISTS "Participants can view conversation members" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can join conversations" ON public.conversation_participants;
DROP POLICY IF EXISTS "Only conversation RPC or existing participant can add members" ON public.conversation_participants;
DROP POLICY IF EXISTS "Participants can update read state" ON public.conversation_participants;
DROP POLICY IF EXISTS "Participants can update own read state" ON public.conversation_participants;
DROP POLICY IF EXISTS "Conversation participants and admins can select members" ON public.conversation_participants;

DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
DROP POLICY IF EXISTS "Conversation participants and admins can select messages" ON public.messages;
DROP POLICY IF EXISTS "Conversation participants can send messages" ON public.messages;

CREATE POLICY "Conversation participants and admins can select"
ON public.conversations
FOR SELECT
TO authenticated
USING (
    public.is_conversation_participant(id, auth.uid())
    OR public.is_gambasket_admin(auth.uid())
);

-- Conversations and participants are created only by the existing
-- SECURITY DEFINER start_product_conversation RPC, preventing arbitrary joins.
CREATE POLICY "Conversation creation is RPC-only"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (FALSE);

CREATE POLICY "Conversation participants and admins can select members"
ON public.conversation_participants
FOR SELECT
TO authenticated
USING (
    public.is_conversation_participant(conversation_id, auth.uid())
    OR public.is_gambasket_admin(auth.uid())
);

CREATE POLICY "Participants can update own read state"
ON public.conversation_participants
FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id
    OR public.is_gambasket_admin(auth.uid())
)
WITH CHECK (
    auth.uid() = user_id
    OR public.is_gambasket_admin(auth.uid())
);

CREATE POLICY "Conversation participants and admins can select messages"
ON public.messages
FOR SELECT
TO authenticated
USING (
    public.is_conversation_participant(conversation_id, auth.uid())
    OR public.is_gambasket_admin(auth.uid())
);

CREATE POLICY "Conversation participants can send messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = sender_id
    AND public.is_conversation_participant(conversation_id, auth.uid())
);
