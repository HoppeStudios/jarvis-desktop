using System;
using System.Windows.Forms;

// Readable native text plus a standard keyboard-accessible choice menu. Unlike
// the themed native ComboBox display, this renders its selection in hidden QA.
public class JarvisCaptureChoice : UserControl {
 readonly TextBox display;
 readonly Button choose;
 readonly ComboBox storage;
 public ComboBox.ObjectCollection Items { get; private set; }
 public object SelectedItem {
  get { return display.Text; }
  set {
   var text = value == null ? "" : value.ToString();
   if (!Items.Contains(text)) throw new ArgumentException("Select an available value");
   display.Text = text;
  }
 }
 public JarvisCaptureChoice() {
  Height = 28;
  storage = new ComboBox(); Items = storage.Items;
  display = new TextBox { ReadOnly = true, Dock = DockStyle.Fill, AccessibleName = "Selected value" };
  choose = new Button { Text = "Choose", Width = 78, Dock = DockStyle.Right, FlatStyle = FlatStyle.Flat, AccessibleName = "Choose value" };
  Controls.Add(display); Controls.Add(choose);
  choose.Click += delegate {
   var menu = new ContextMenuStrip();
   foreach (var option in Items) {
    var value = option.ToString();
    var item = new ToolStripMenuItem(value) { Checked = value == display.Text };
    var selection = value;
    item.Click += delegate { SelectedItem = selection; };
    menu.Items.Add(item);
   }
   menu.Closed += delegate { menu.Dispose(); };
   menu.Show(choose, 0, choose.Height);
  };
 }
 protected override void Dispose(bool disposing) {
  if (disposing && storage != null) storage.Dispose();
  base.Dispose(disposing);
 }
 protected override void OnBackColorChanged(EventArgs e) {
  base.OnBackColorChanged(e);
  if (display != null) display.BackColor = BackColor;
  if (choose != null) choose.BackColor = BackColor;
 }
 protected override void OnForeColorChanged(EventArgs e) {
  base.OnForeColorChanged(e);
  if (display != null) display.ForeColor = ForeColor;
  if (choose != null) choose.ForeColor = ForeColor;
 }
}
