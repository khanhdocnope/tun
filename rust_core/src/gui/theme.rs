use eframe::egui::{self, Color32, CornerRadius, Stroke, Visuals};

pub struct CatppuccinMocha;

impl CatppuccinMocha {
    pub const CRUST: Color32 = Color32::from_rgb(17, 17, 27);
    pub const MANTLE: Color32 = Color32::from_rgb(24, 24, 37);
    pub const BASE: Color32 = Color32::from_rgb(30, 30, 46);
    pub const SURFACE0: Color32 = Color32::from_rgb(49, 50, 68);
    pub const SURFACE1: Color32 = Color32::from_rgb(69, 71, 90);
    pub const SURFACE2: Color32 = Color32::from_rgb(88, 91, 112);
    pub const OVERLAY0: Color32 = Color32::from_rgb(108, 112, 134);
    pub const TEXT: Color32 = Color32::from_rgb(205, 214, 244);
    pub const SUBTEXT0: Color32 = Color32::from_rgb(166, 173, 200);
    pub const SUBTEXT1: Color32 = Color32::from_rgb(186, 194, 222);

    // Accents
    pub const LAVENDER: Color32 = Color32::from_rgb(180, 190, 254);
    pub const MAUVE: Color32 = Color32::from_rgb(203, 166, 247);
    pub const SAPPHIRE: Color32 = Color32::from_rgb(116, 199, 236);
    pub const BLUE: Color32 = Color32::from_rgb(137, 180, 250);
    pub const TEAL: Color32 = Color32::from_rgb(148, 226, 213);
    pub const GREEN: Color32 = Color32::from_rgb(166, 227, 161);
    pub const PEACH: Color32 = Color32::from_rgb(250, 179, 135);
    pub const RED: Color32 = Color32::from_rgb(243, 139, 168);
    pub const YELLOW: Color32 = Color32::from_rgb(249, 226, 175);

    pub fn apply(ctx: &egui::Context) {
        let mut visuals = Visuals::dark();

        visuals.panel_fill = Self::MANTLE;
        visuals.window_fill = Self::BASE;
        visuals.faint_bg_color = Self::CRUST;
        visuals.extreme_bg_color = Self::CRUST;

        visuals.widgets.noninteractive.bg_fill = Self::BASE;
        visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, Self::TEXT);
        visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, Self::SURFACE0);
        visuals.widgets.noninteractive.corner_radius = CornerRadius::same(6);

        visuals.widgets.inactive.bg_fill = Self::SURFACE0;
        visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, Self::SUBTEXT1);
        visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, Self::SURFACE1);
        visuals.widgets.inactive.corner_radius = CornerRadius::same(6);

        visuals.widgets.hovered.bg_fill = Self::SURFACE1;
        visuals.widgets.hovered.fg_stroke = Stroke::new(1.0, Self::TEXT);
        visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, Self::LAVENDER);
        visuals.widgets.hovered.corner_radius = CornerRadius::same(6);

        visuals.widgets.active.bg_fill = Self::SURFACE2;
        visuals.widgets.active.fg_stroke = Stroke::new(1.0, Self::LAVENDER);
        visuals.widgets.active.bg_stroke = Stroke::new(1.5, Self::MAUVE);
        visuals.widgets.active.corner_radius = CornerRadius::same(6);

        visuals.selection.bg_fill = Self::SURFACE1;
        visuals.selection.stroke = Stroke::new(1.0, Self::LAVENDER);

        ctx.set_visuals(visuals);
    }
}
