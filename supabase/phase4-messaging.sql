-- GamBasket Phase 4 messaging migration. Run after schema.sql.

CREATE OR REPLACE FUNCTION public.start_product_conversation(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_seller UUID;
    v_conversation UUID;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    SELECT seller_id INTO v_seller FROM public.products WHERE id = p_product_id AND status = 'approved';
    IF v_seller IS NULL THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE'; END IF;
    IF v_seller = v_user THEN RAISE EXCEPTION 'CANNOT_MESSAGE_SELF'; END IF;

    SELECT c.id INTO v_conversation
    FROM public.conversations c
    JOIN public.conversation_participants buyer ON buyer.conversation_id = c.id AND buyer.user_id = v_user
    JOIN public.conversation_participants seller ON seller.conversation_id = c.id AND seller.user_id = v_seller
    WHERE c.product_id = p_product_id
    LIMIT 1;

    IF v_conversation IS NULL THEN
        INSERT INTO public.conversations (product_id) VALUES (p_product_id) RETURNING id INTO v_conversation;
        INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (v_conversation, v_user), (v_conversation, v_seller);
    END IF;

    RETURN jsonb_build_object('id', v_conversation, 'product_id', p_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = p_conversation_id AND user_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_CONVERSATION_PARTICIPANT';
    END IF;
    UPDATE public.messages SET is_read = TRUE WHERE conversation_id = p_conversation_id AND sender_id <> auth.uid();
    UPDATE public.conversation_participants SET last_read_at = NOW() WHERE conversation_id = p_conversation_id AND user_id = auth.uid();
END;
$$;

DROP POLICY IF EXISTS "Users can join conversations" ON public.conversation_participants;
CREATE POLICY "Only conversation RPC or existing participant can add members" ON public.conversation_participants FOR INSERT
    WITH CHECK (auth.uid() IN (SELECT user_id FROM public.conversation_participants WHERE conversation_id = conversation_participants.conversation_id));

DROP POLICY IF EXISTS "Participants can update read state" ON public.conversation_participants;
CREATE POLICY "Participants can update own read state" ON public.conversation_participants FOR UPDATE
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own notifications" ON public.notifications;
CREATE POLICY "Users can read and update own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can mark own notifications read" ON public.notifications FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON FUNCTION public.start_product_conversation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_product_conversation(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.notify_message_recipient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.conversations SET updated_at = NOW() WHERE id = NEW.conversation_id;
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT cp.user_id, 'message', 'New message', LEFT(NEW.message_text, 160), jsonb_build_object('conversation_id', NEW.conversation_id)
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> NEW.sender_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_created ON public.messages;
CREATE TRIGGER on_message_created AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_message_recipient();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime FOR TABLE public.conversations, public.conversation_participants, public.messages;
    ELSE
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
    END IF;
END $$;
