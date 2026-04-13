--
-- PostgreSQL database dump
--

\restrict 5IqoTc6OsedrCuJuefpjDmvXmL22fo565zSoYnVfhTwQphTCqE1T49k6toVk672

-- Dumped from database version 14.20 (Homebrew)
-- Dumped by pg_dump version 14.20 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clientes; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.clientes (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    nombre character varying(150) NOT NULL,
    documento character varying(40),
    telefono character varying(40),
    correo character varying(120),
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.clientes OWNER TO victor;

--
-- Name: clientes_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.clientes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.clientes_id_seq OWNER TO victor;

--
-- Name: clientes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.clientes_id_seq OWNED BY public.clientes.id;


--
-- Name: empleados; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.empleados (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    nombre character varying(150) NOT NULL,
    rol character varying(40) NOT NULL,
    telefono character varying(40),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.empleados OWNER TO victor;

--
-- Name: empleados_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.empleados_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.empleados_id_seq OWNER TO victor;

--
-- Name: empleados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.empleados_id_seq OWNED BY public.empleados.id;


--
-- Name: empresas; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.empresas (
    id bigint NOT NULL,
    nombre character varying(150) NOT NULL,
    nit character varying(30),
    ciudad character varying(80),
    direccion character varying(150),
    telefono character varying(30),
    email_contacto character varying(120),
    logo_url text,
    zona_horaria character varying(50) DEFAULT 'America/Bogota'::character varying,
    licencia_tipo character varying(30) DEFAULT 'demo'::character varying,
    licencia_inicio timestamp with time zone DEFAULT now(),
    licencia_fin timestamp with time zone,
    activa boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.empresas OWNER TO victor;

--
-- Name: empresas_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.empresas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.empresas_id_seq OWNER TO victor;

--
-- Name: empresas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.empresas_id_seq OWNED BY public.empresas.id;


--
-- Name: lavadero; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.lavadero (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    vehiculo_id bigint,
    cliente_id bigint,
    tipo_lavado_id bigint,
    lavador_id bigint,
    placa character varying(20) NOT NULL,
    precio numeric(12,2) NOT NULL,
    estado character varying(30) DEFAULT 'Pendiente'::character varying NOT NULL,
    hora_inicio timestamp with time zone DEFAULT now() NOT NULL,
    hora_fin timestamp with time zone,
    observaciones text,
    metodo_pago character varying(30),
    detalle_pago jsonb,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lavadero OWNER TO victor;

--
-- Name: lavadero_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.lavadero_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.lavadero_id_seq OWNER TO victor;

--
-- Name: lavadero_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.lavadero_id_seq OWNED BY public.lavadero.id;


--
-- Name: lavados; Type: VIEW; Schema: public; Owner: victor
--

CREATE VIEW public.lavados AS
 SELECT lavadero.id,
    lavadero.empresa_id,
    lavadero.vehiculo_id,
    lavadero.cliente_id,
    lavadero.tipo_lavado_id,
    lavadero.lavador_id,
    lavadero.placa,
    lavadero.precio,
    lavadero.estado,
    lavadero.hora_inicio,
    lavadero.hora_fin,
    lavadero.observaciones,
    lavadero.metodo_pago,
    lavadero.detalle_pago,
    lavadero.creado_en
   FROM public.lavadero;


ALTER TABLE public.lavados OWNER TO victor;

--
-- Name: taller_ordenes; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.taller_ordenes (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    vehiculo_id bigint,
    cliente_id bigint,
    mecanico_id bigint,
    numero_orden character varying(40) NOT NULL,
    placa character varying(20) NOT NULL,
    descripcion_falla text,
    estado character varying(30) DEFAULT 'Diagnóstico'::character varying NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT now() NOT NULL,
    fecha_entrega timestamp with time zone,
    total_orden numeric(14,2) DEFAULT 0
);


ALTER TABLE public.taller_ordenes OWNER TO victor;

--
-- Name: ordenes_taller; Type: VIEW; Schema: public; Owner: victor
--

CREATE VIEW public.ordenes_taller AS
 SELECT taller_ordenes.id,
    taller_ordenes.empresa_id,
    taller_ordenes.vehiculo_id,
    taller_ordenes.cliente_id,
    taller_ordenes.mecanico_id,
    taller_ordenes.numero_orden,
    taller_ordenes.placa,
    taller_ordenes.descripcion_falla,
    taller_ordenes.estado,
    taller_ordenes.fecha_creacion,
    taller_ordenes.fecha_entrega,
    taller_ordenes.total_orden
   FROM public.taller_ordenes;


ALTER TABLE public.ordenes_taller OWNER TO victor;

--
-- Name: parqueadero; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.parqueadero (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    vehiculo_id bigint,
    cliente_id bigint,
    placa character varying(20) NOT NULL,
    tipo_vehiculo character varying(30) NOT NULL,
    nombre_cliente character varying(150),
    telefono character varying(40),
    es_propietario boolean DEFAULT true,
    hora_entrada timestamp with time zone DEFAULT now() NOT NULL,
    hora_salida timestamp with time zone,
    minutos_total integer,
    valor_total numeric(12,2),
    metodo_pago character varying(30),
    detalle_pago text,
    observaciones text,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    conductor_nombre character varying(150),
    conductor_documento character varying(40),
    conductor_telefono character varying(40),
    evidencia_url text,
    estado_pago character varying(30),
    usuario_registro_id bigint,
    cantidad_fotos integer
);


ALTER TABLE public.parqueadero OWNER TO victor;

--
-- Name: parqueadero_historial; Type: VIEW; Schema: public; Owner: victor
--

CREATE VIEW public.parqueadero_historial AS
 SELECT parqueadero.id,
    parqueadero.empresa_id,
    parqueadero.vehiculo_id,
    parqueadero.cliente_id,
    parqueadero.placa,
    parqueadero.tipo_vehiculo,
    parqueadero.nombre_cliente,
    parqueadero.telefono,
    parqueadero.es_propietario,
    parqueadero.hora_entrada,
    parqueadero.hora_salida,
    parqueadero.minutos_total,
    parqueadero.valor_total,
    parqueadero.metodo_pago,
    parqueadero.detalle_pago,
    parqueadero.observaciones,
    parqueadero.creado_en
   FROM public.parqueadero
  WHERE (parqueadero.hora_salida IS NOT NULL);


ALTER TABLE public.parqueadero_historial OWNER TO victor;

--
-- Name: parqueadero_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.parqueadero_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.parqueadero_id_seq OWNER TO victor;

--
-- Name: parqueadero_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.parqueadero_id_seq OWNED BY public.parqueadero.id;


--
-- Name: taller_items; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.taller_items (
    id bigint NOT NULL,
    orden_id bigint NOT NULL,
    tipo_item character varying(20) NOT NULL,
    descripcion text NOT NULL,
    cantidad numeric(12,2) DEFAULT 1 NOT NULL,
    precio_unitario numeric(12,2) DEFAULT 0 NOT NULL,
    total_linea numeric(14,2) DEFAULT 0 NOT NULL
);


ALTER TABLE public.taller_items OWNER TO victor;

--
-- Name: taller_items_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.taller_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.taller_items_id_seq OWNER TO victor;

--
-- Name: taller_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.taller_items_id_seq OWNED BY public.taller_items.id;


--
-- Name: taller_ordenes_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.taller_ordenes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.taller_ordenes_id_seq OWNER TO victor;

--
-- Name: taller_ordenes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.taller_ordenes_id_seq OWNED BY public.taller_ordenes.id;


--
-- Name: tipos_lavado; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.tipos_lavado (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    precio_base numeric(12,2) DEFAULT 0,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tipos_lavado OWNER TO victor;

--
-- Name: tipos_lavado_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.tipos_lavado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.tipos_lavado_id_seq OWNER TO victor;

--
-- Name: tipos_lavado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.tipos_lavado_id_seq OWNED BY public.tipos_lavado.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.usuarios (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    nombre character varying(120) NOT NULL,
    email character varying(120) NOT NULL,
    password_hash character varying(200) NOT NULL,
    rol character varying(30) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.usuarios OWNER TO victor;

--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.usuarios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.usuarios_id_seq OWNER TO victor;

--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: vehiculos; Type: TABLE; Schema: public; Owner: victor
--

CREATE TABLE public.vehiculos (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    cliente_id bigint,
    placa character varying(20) NOT NULL,
    tipo_vehiculo character varying(30) NOT NULL,
    marca character varying(60),
    modelo character varying(60),
    color character varying(40),
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vehiculos OWNER TO victor;

--
-- Name: vehiculos_id_seq; Type: SEQUENCE; Schema: public; Owner: victor
--

CREATE SEQUENCE public.vehiculos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.vehiculos_id_seq OWNER TO victor;

--
-- Name: vehiculos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: victor
--

ALTER SEQUENCE public.vehiculos_id_seq OWNED BY public.vehiculos.id;


--
-- Name: clientes id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id SET DEFAULT nextval('public.clientes_id_seq'::regclass);


--
-- Name: empleados id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.empleados ALTER COLUMN id SET DEFAULT nextval('public.empleados_id_seq'::regclass);


--
-- Name: empresas id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.empresas ALTER COLUMN id SET DEFAULT nextval('public.empresas_id_seq'::regclass);


--
-- Name: lavadero id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero ALTER COLUMN id SET DEFAULT nextval('public.lavadero_id_seq'::regclass);


--
-- Name: parqueadero id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.parqueadero ALTER COLUMN id SET DEFAULT nextval('public.parqueadero_id_seq'::regclass);


--
-- Name: taller_items id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_items ALTER COLUMN id SET DEFAULT nextval('public.taller_items_id_seq'::regclass);


--
-- Name: taller_ordenes id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_ordenes ALTER COLUMN id SET DEFAULT nextval('public.taller_ordenes_id_seq'::regclass);


--
-- Name: tipos_lavado id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.tipos_lavado ALTER COLUMN id SET DEFAULT nextval('public.tipos_lavado_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Name: vehiculos id; Type: DEFAULT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.vehiculos ALTER COLUMN id SET DEFAULT nextval('public.vehiculos_id_seq'::regclass);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: empleados empleados_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.empleados
    ADD CONSTRAINT empleados_pkey PRIMARY KEY (id);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);


--
-- Name: lavadero lavadero_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero
    ADD CONSTRAINT lavadero_pkey PRIMARY KEY (id);


--
-- Name: parqueadero parqueadero_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.parqueadero
    ADD CONSTRAINT parqueadero_pkey PRIMARY KEY (id);


--
-- Name: taller_items taller_items_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_items
    ADD CONSTRAINT taller_items_pkey PRIMARY KEY (id);


--
-- Name: taller_ordenes taller_ordenes_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_ordenes
    ADD CONSTRAINT taller_ordenes_pkey PRIMARY KEY (id);


--
-- Name: tipos_lavado tipos_lavado_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.tipos_lavado
    ADD CONSTRAINT tipos_lavado_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: vehiculos vehiculos_pkey; Type: CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.vehiculos
    ADD CONSTRAINT vehiculos_pkey PRIMARY KEY (id);


--
-- Name: clientes_empresa_documento_uniq; Type: INDEX; Schema: public; Owner: victor
--

CREATE UNIQUE INDEX clientes_empresa_documento_uniq ON public.clientes USING btree (empresa_id, documento) WHERE (documento IS NOT NULL);


--
-- Name: empleados_empresa_idx; Type: INDEX; Schema: public; Owner: victor
--

CREATE INDEX empleados_empresa_idx ON public.empleados USING btree (empresa_id);


--
-- Name: empresas_nit_uniq; Type: INDEX; Schema: public; Owner: victor
--

CREATE UNIQUE INDEX empresas_nit_uniq ON public.empresas USING btree (nit);


--
-- Name: lavadero_empresa_estado_idx; Type: INDEX; Schema: public; Owner: victor
--

CREATE INDEX lavadero_empresa_estado_idx ON public.lavadero USING btree (empresa_id, estado);


--
-- Name: parqueadero_abiertos_idx; Type: INDEX; Schema: public; Owner: victor
--

CREATE INDEX parqueadero_abiertos_idx ON public.parqueadero USING btree (empresa_id) WHERE (hora_salida IS NULL);


--
-- Name: parqueadero_empresa_idx; Type: INDEX; Schema: public; Owner: victor
--

CREATE INDEX parqueadero_empresa_idx ON public.parqueadero USING btree (empresa_id, hora_entrada);


--
-- Name: taller_ordenes_empresa_orden_uniq; Type: INDEX; Schema: public; Owner: victor
--

CREATE UNIQUE INDEX taller_ordenes_empresa_orden_uniq ON public.taller_ordenes USING btree (empresa_id, numero_orden);


--
-- Name: tipos_lavado_empresa_nombre_uniq; Type: INDEX; Schema: public; Owner: victor
--

CREATE UNIQUE INDEX tipos_lavado_empresa_nombre_uniq ON public.tipos_lavado USING btree (empresa_id, nombre);


--
-- Name: usuarios_empresa_email_uniq; Type: INDEX; Schema: public; Owner: victor
--

CREATE UNIQUE INDEX usuarios_empresa_email_uniq ON public.usuarios USING btree (empresa_id, email);


--
-- Name: vehiculos_empresa_placa_uniq; Type: INDEX; Schema: public; Owner: victor
--

CREATE UNIQUE INDEX vehiculos_empresa_placa_uniq ON public.vehiculos USING btree (empresa_id, placa);


--
-- Name: clientes clientes_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: empleados empleados_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.empleados
    ADD CONSTRAINT empleados_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: lavadero lavadero_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero
    ADD CONSTRAINT lavadero_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;


--
-- Name: lavadero lavadero_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero
    ADD CONSTRAINT lavadero_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: lavadero lavadero_lavador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero
    ADD CONSTRAINT lavadero_lavador_id_fkey FOREIGN KEY (lavador_id) REFERENCES public.empleados(id) ON DELETE SET NULL;


--
-- Name: lavadero lavadero_tipo_lavado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero
    ADD CONSTRAINT lavadero_tipo_lavado_id_fkey FOREIGN KEY (tipo_lavado_id) REFERENCES public.tipos_lavado(id) ON DELETE SET NULL;


--
-- Name: lavadero lavadero_vehiculo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.lavadero
    ADD CONSTRAINT lavadero_vehiculo_id_fkey FOREIGN KEY (vehiculo_id) REFERENCES public.vehiculos(id) ON DELETE SET NULL;


--
-- Name: parqueadero parqueadero_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.parqueadero
    ADD CONSTRAINT parqueadero_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;


--
-- Name: parqueadero parqueadero_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.parqueadero
    ADD CONSTRAINT parqueadero_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: parqueadero parqueadero_vehiculo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.parqueadero
    ADD CONSTRAINT parqueadero_vehiculo_id_fkey FOREIGN KEY (vehiculo_id) REFERENCES public.vehiculos(id) ON DELETE SET NULL;


--
-- Name: taller_items taller_items_orden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_items
    ADD CONSTRAINT taller_items_orden_id_fkey FOREIGN KEY (orden_id) REFERENCES public.taller_ordenes(id) ON DELETE CASCADE;


--
-- Name: taller_ordenes taller_ordenes_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_ordenes
    ADD CONSTRAINT taller_ordenes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: taller_ordenes taller_ordenes_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_ordenes
    ADD CONSTRAINT taller_ordenes_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: taller_ordenes taller_ordenes_mecanico_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_ordenes
    ADD CONSTRAINT taller_ordenes_mecanico_id_fkey FOREIGN KEY (mecanico_id) REFERENCES public.empleados(id);


--
-- Name: taller_ordenes taller_ordenes_vehiculo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.taller_ordenes
    ADD CONSTRAINT taller_ordenes_vehiculo_id_fkey FOREIGN KEY (vehiculo_id) REFERENCES public.vehiculos(id);


--
-- Name: tipos_lavado tipos_lavado_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.tipos_lavado
    ADD CONSTRAINT tipos_lavado_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: usuarios usuarios_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: vehiculos vehiculos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.vehiculos
    ADD CONSTRAINT vehiculos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;


--
-- Name: vehiculos vehiculos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: victor
--

ALTER TABLE ONLY public.vehiculos
    ADD CONSTRAINT vehiculos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 5IqoTc6OsedrCuJuefpjDmvXmL22fo565zSoYnVfhTwQphTCqE1T49k6toVk672
